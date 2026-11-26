import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  AbortMultipartUploadCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import dataSource from '../src/modules/database/data-source.js';
import {
  FileRecord,
  FileStatus,
} from '../src/modules/database/entities/file.entity.js';
import { RefreshToken } from '../src/modules/database/entities/refreshToken.entity.js';
import { User } from '../src/modules/database/entities/user.entity.js';
import { seedDatabase } from '../src/modules/database/seed/seed-database.js';
import { MIN_MULTIPART_PART_SIZE_BYTES } from '../src/modules/uploads/upload-policy.js';

const PORT = 21_263;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DEMO_EMAIL = 'customer.one@example.com';
const DEMO_PASSWORD = 'demo-password';
const CONTENT_TYPE = 'application/octet-stream';
const EXPECTED_PARTS = 3;
// 2 full 5 MiB parts + 64 KiB tail = 10,551,296 bytes (> 10 MiB threshold -> 3 parts)
const TOTAL_BYTES = MIN_MULTIPART_PART_SIZE_BYTES * 2 + 64 * 1024;
const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;

type MultipartDemoMetrics = {
  headBeforeComplete: number;
  resumedParts: number;
  complete: number;
  sizeMatch: 0 | 1;
  etagMultipart: 0 | 1;
};

type WorkerOneResult = {
  fileId: string;
  key: string;
  uploadedCount: number;
};

type WorkerTwoResult = {
  resumedParts: number;
  completeStatus: number;
};

async function main(): Promise<void> {
  const bucket = requiredEnv('STORAGE_BUCKET');
  const s3 = createS3Client();
  const tempFilePath = path.join(
    os.tmpdir(),
    `marketplace-hw26-multipart-${process.pid}.bin`,
  );
  let app: ChildProcess | undefined;
  let userId: string | undefined;

  try {
    await ensureBucket(s3, bucket);
    await dataSource.initialize();
    await dataSource.runMigrations();
    await seedDatabase(dataSource);

    const user = await dataSource.getRepository(User).findOneBy({
      email: DEMO_EMAIL,
    });
    if (!user) {
      throw new Error(`Seed user was not found: ${DEMO_EMAIL}`);
    }
    userId = user.id;

    await resetDemoState(s3, bucket, userId);

    // Deterministic-size binary fixture split into 3 parts (5 MiB + 5 MiB + 64 KiB)
    await writeFile(tempFilePath, randomBytes(TOTAL_BYTES));

    app = startApplication(PORT);
    await waitUntilReady(app, PORT);

    const accessToken = await login();

    // Process #1: creates multipart intent, uploads parts 1 & 2, then stops abruptly
    const worker1 = await runFirstUploadProcess({
      baseUrl: BASE_URL,
      accessToken,
      filePath: tempFilePath,
      totalBytes: TOTAL_BYTES,
      contentType: CONTENT_TYPE,
      stopAfterParts: 2,
    });

    if (worker1.uploadedCount !== 2) {
      throw new Error(
        `First upload process expected to upload 2 parts, uploaded ${worker1.uploadedCount}`,
      );
    }

    // Object must NOT exist before CompleteMultipartUpload even though 2 parts are stored
    const headBeforeComplete = await headStatus(s3, bucket, worker1.key);

    // Process #2 (fresh process): queries ListParts via API, uploads ONLY missing parts, commits
    const worker2 = await runResumeUploadProcess({
      baseUrl: BASE_URL,
      accessToken,
      fileId: worker1.fileId,
      filePath: tempFilePath,
    });

    // Verify assembled object size & multipart ETag (-N suffix)
    const headAfter = await s3.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: worker1.key,
      }),
    );

    const sizeMatch: 0 | 1 = headAfter.ContentLength === TOTAL_BYTES ? 1 : 0;
    const etag = headAfter.ETag ?? '';
    const etagMultipart: 0 | 1 = new RegExp(
      `^"?[0-9a-f]+-${EXPECTED_PARTS}"?$`,
      'i',
    ).test(etag)
      ? 1
      : 0;

    const committedRow = await dataSource.getRepository(FileRecord).findOneBy({
      id: worker1.fileId,
    });
    if (!committedRow || committedRow.status !== FileStatus.COMPLETED) {
      throw new Error(
        `Expected DB row ${worker1.fileId} to be COMPLETED, got ${committedRow?.status ?? 'missing'}`,
      );
    }

    const metrics: MultipartDemoMetrics = {
      headBeforeComplete,
      resumedParts: worker2.resumedParts,
      complete: worker2.completeStatus,
      sizeMatch,
      etagMultipart,
    };

    printMetrics(metrics);
    assertMetrics(metrics);
  } finally {
    if (app) {
      await stopApplication(app);
    }

    await rm(tempFilePath, { force: true }).catch(() => undefined);

    if (userId) {
      await resetDemoState(s3, bucket, userId).catch(() => undefined);
    }

    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }

    s3.destroy();
  }
}

async function runFirstUploadProcess(input: {
  baseUrl: string;
  accessToken: string;
  filePath: string;
  totalBytes: number;
  contentType: string;
  stopAfterParts: number;
}): Promise<WorkerOneResult> {
  const script = `
    const { open } = require('node:fs/promises');
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { raw += c; });
    process.stdin.on('end', async () => {
      const cfg = JSON.parse(raw);
      const intentRes = await fetch(cfg.baseUrl + '/uploads/intent', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + cfg.accessToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          contentType: cfg.contentType,
          size: cfg.totalBytes,
          filename: 'catalog-dump.bin',
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (intentRes.status !== 200) {
        throw new Error('Intent failed with status ' + intentRes.status);
      }
      const intent = await intentRes.json();
      if (intent.mode !== 'multipart' || intent.partCount !== 3) {
        throw new Error('Expected 3-part multipart intent, got ' + JSON.stringify({ mode: intent.mode, partCount: intent.partCount }));
      }

      const handle = await open(cfg.filePath, 'r');
      let uploadedCount = 0;
      try {
        for (const part of intent.parts.slice(0, cfg.stopAfterParts)) {
          const offset = (part.partNumber - 1) * intent.partSize;
          const length = Math.min(intent.partSize, cfg.totalBytes - offset);
          const buf = Buffer.allocUnsafe(length);
          const { bytesRead } = await handle.read(buf, 0, length, offset);
          const putRes = await fetch(part.uploadUrl, {
            method: 'PUT',
            body: buf.subarray(0, bytesRead),
            signal: AbortSignal.timeout(30000),
          });
          await putRes.arrayBuffer();
          if (putRes.status !== 200) {
            throw new Error('Part ' + part.partNumber + ' PUT failed with ' + putRes.status);
          }
          uploadedCount += 1;
        }
      } finally {
        await handle.close();
      }

      process.stdout.write(JSON.stringify({
        fileId: intent.fileId,
        key: intent.key,
        uploadedCount,
      }));
    });
  `;

  return runChildJson<WorkerOneResult>(script, input);
}

async function runResumeUploadProcess(input: {
  baseUrl: string;
  accessToken: string;
  fileId: string;
  filePath: string;
}): Promise<WorkerTwoResult> {
  const script = `
    const { open, stat } = require('node:fs/promises');
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { raw += c; });
    process.stdin.on('end', async () => {
      const cfg = JSON.parse(raw);
      const partsRes = await fetch(cfg.baseUrl + '/uploads/' + cfg.fileId + '/parts', {
        method: 'GET',
        headers: {
          authorization: 'Bearer ' + cfg.accessToken,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (partsRes.status !== 200) {
        throw new Error('GET /uploads/:fileId/parts failed with ' + partsRes.status);
      }
      const state = await partsRes.json();
      const { size: totalBytes } = await stat(cfg.filePath);

      const handle = await open(cfg.filePath, 'r');
      let resumedParts = 0;
      try {
        for (const part of state.missingParts) {
          const offset = (part.partNumber - 1) * state.partSize;
          const length = Math.min(state.partSize, totalBytes - offset);
          const buf = Buffer.allocUnsafe(length);
          const { bytesRead } = await handle.read(buf, 0, length, offset);
          const putRes = await fetch(part.uploadUrl, {
            method: 'PUT',
            body: buf.subarray(0, bytesRead),
            signal: AbortSignal.timeout(30000),
          });
          await putRes.arrayBuffer();
          if (putRes.status !== 200) {
            throw new Error('Resumed part ' + part.partNumber + ' PUT failed with ' + putRes.status);
          }
          resumedParts += 1;
        }
      } finally {
        await handle.close();
      }

      const commitRes = await fetch(cfg.baseUrl + '/uploads/commit', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + cfg.accessToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ fileId: cfg.fileId }),
        signal: AbortSignal.timeout(15000),
      });
      await commitRes.arrayBuffer();

      process.stdout.write(JSON.stringify({
        resumedParts,
        completeStatus: commitRes.status,
      }));
    });
  `;

  return runChildJson<WorkerTwoResult>(script, input);
}

function runChildJson<T>(script: string, payload: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], {
      // Stripped environment: worker process has no storage credentials.
      env: {
        PATH: process.env.PATH ?? '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as T);
      } catch (parseError: unknown) {
        reject(
          new Error(
            `Failed to parse worker output (${String(parseError)}): ${stdout}`,
          ),
        );
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

async function headStatus(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<number> {
  try {
    const res = await s3.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    return res.$metadata.httpStatusCode ?? 200;
  } catch (error: unknown) {
    if (error instanceof S3ServiceException && error.$metadata.httpStatusCode) {
      return error.$metadata.httpStatusCode;
    }
    throw error;
  }
}

function createS3Client(): S3Client {
  const endpoint = process.env.STORAGE_ENDPOINT?.trim() || undefined;
  return new S3Client({
    region: process.env.STORAGE_REGION?.trim() || 'us-east-1',
    endpoint,
    forcePathStyle: Boolean(endpoint),
    credentials: {
      accessKeyId: requiredEnv('STORAGE_ACCESS_KEY'),
      secretAccessKey: requiredEnv('STORAGE_SECRET_KEY'),
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
}

async function ensureBucket(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error: unknown) {
    if (
      error instanceof S3ServiceException &&
      error.$metadata.httpStatusCode === 404
    ) {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      return;
    }
    throw error;
  }
}

async function resetDemoState(
  s3: S3Client,
  bucket: string,
  userId: string,
): Promise<void> {
  const prefix = `uploads/${userId}/`;

  // 1. Abort all incomplete multipart uploads under this user's prefix
  let keyMarker: string | undefined;
  let uploadIdMarker: string | undefined;

  do {
    const uploads = await s3.send(
      new ListMultipartUploadsCommand({
        Bucket: bucket,
        Prefix: prefix,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
      }),
    );

    for (const upload of uploads.Uploads ?? []) {
      if (upload.Key && upload.UploadId) {
        await s3.send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: upload.Key,
            UploadId: upload.UploadId,
          }),
        );
      }
    }

    if (uploads.IsTruncated) {
      keyMarker = uploads.NextKeyMarker;
      uploadIdMarker = uploads.NextUploadIdMarker;
    } else {
      keyMarker = undefined;
      uploadIdMarker = undefined;
    }
  } while (keyMarker || uploadIdMarker);

  // 2. Delete completed objects under this user's prefix
  let continuationToken: string | undefined;

  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of list.Contents ?? []) {
      if (object.Key) {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: object.Key,
          }),
        );
      }
    }

    continuationToken = list.IsTruncated
      ? list.NextContinuationToken
      : undefined;
  } while (continuationToken);

  // 3. Remove DB fixture rows
  if (dataSource.isInitialized) {
    await dataSource
      .getRepository(FileRecord)
      .createQueryBuilder()
      .delete()
      .from(FileRecord)
      .where('owner_id = :userId', { userId })
      .execute();

    await dataSource
      .getRepository(RefreshToken)
      .createQueryBuilder()
      .delete()
      .from(RefreshToken)
      .where('user_id = :userId', { userId })
      .execute();
  }
}

async function login(): Promise<string> {
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
    }),
    signal: AbortSignal.timeout(5_000),
  });

  if (response.status !== 200) {
    throw new Error(`Login failed with status ${response.status}`);
  }

  const body = (await response.json()) as { accessToken?: unknown };
  if (typeof body.accessToken !== 'string') {
    throw new Error('Login response did not contain accessToken');
  }

  return body.accessToken;
}

function startApplication(port: number): ChildProcess {
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));

  return child;
}

async function waitUntilReady(app: ChildProcess, port: number): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (app.exitCode !== null) {
      throw new Error(`Application exited during startup: ${app.exitCode}`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });

      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
    } catch {
      // Expected while Nest is booting.
    }

    await delay(100);
  }

  throw new Error(`Application did not start within ${START_TIMEOUT_MS}ms`);
}

async function stopApplication(app: ChildProcess): Promise<void> {
  if (app.exitCode !== null) return;

  app.kill('SIGTERM');

  const exited = await Promise.race([
    new Promise<true>((resolve) => app.once('exit', () => resolve(true))),
    delay(STOP_TIMEOUT_MS).then(() => false),
  ]);

  if (!exited && app.exitCode === null) {
    app.kill('SIGKILL');
    await new Promise<void>((resolve) => app.once('exit', () => resolve()));
  }
}

function printMetrics(m: MultipartDemoMetrics): void {
  console.log(`head-before-complete=${m.headBeforeComplete}`);
  console.log(`resumed-parts=${m.resumedParts}`);
  console.log(`complete=${m.complete}`);
  console.log(`size-match=${m.sizeMatch}`);
  console.log(`etag-multipart=${m.etagMultipart}`);
}

function assertMetrics(m: MultipartDemoMetrics): void {
  const checks: Array<[string, boolean, string]> = [
    [
      'head-before-complete',
      m.headBeforeComplete === 404,
      `expected 404, got ${m.headBeforeComplete}`,
    ],
    [
      'resumed-parts',
      m.resumedParts === 1,
      `expected 1, got ${m.resumedParts}`,
    ],
    ['complete', m.complete === 200, `expected 200, got ${m.complete}`],
    ['size-match', m.sizeMatch === 1, `expected 1, got ${m.sizeMatch}`],
    [
      'etag-multipart',
      m.etagMultipart === 1,
      `expected 1, got ${m.etagMultipart}`,
    ],
  ];

  const failures = checks
    .filter(([, ok]) => !ok)
    .map(([name, , detail]) => `${name}: ${detail}`);

  if (failures.length > 0) {
    throw new Error(`Multipart demo invariant failed: ${failures.join('; ')}`);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
