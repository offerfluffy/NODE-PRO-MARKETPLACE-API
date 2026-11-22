import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dataSource from '../src/modules/database/data-source.js';
import {
  FileRecord,
  FileStatus,
} from '../src/modules/database/entities/file.entity.js';
import { RefreshToken } from '../src/modules/database/entities/refreshToken.entity.js';
import { User } from '../src/modules/database/entities/user.entity.js';
import { seedDatabase } from '../src/modules/database/seed/seed-database.js';

const PORT_BEFORE_STOP = 21_261;
const PORT_AFTER_RESTART = 21_262;
const DEMO_EMAIL = 'customer.one@example.com';
const DEMO_PASSWORD = 'demo-password';
const MALICIOUS_FILENAME = '../../etc/passwd';
const CONTENT_TYPE = 'image/png';
const PAYLOAD = Buffer.from('89504e470d0a1a0a-hw26-presigned-upload-payload');
const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;

type UploadDemoMetrics = {
  intent: number;
  keyFromServer: 0 | 1;
  apiAlive: 0 | 1;
  putOffline: number;
  commit: number;
  commitWithoutBytes: number;
  tampered: number;
  expired: number;
};

type IntentResponse = {
  fileId: string;
  key: string;
  uploadUrl: string;
  expiresIn: number;
};

async function main(): Promise<void> {
  const bucket = requiredEnv('STORAGE_BUCKET');
  const s3 = createS3Client();
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

    // 1. Start API on port #1, log in, request upload intent with malicious filename
    app = startApplication(PORT_BEFORE_STOP);
    await waitUntilReady(app, PORT_BEFORE_STOP);

    const accessToken = await login(PORT_BEFORE_STOP);
    const intentResponse = await requestIntent(PORT_BEFORE_STOP, accessToken, {
      contentType: CONTENT_TYPE,
      size: PAYLOAD.byteLength,
      filename: MALICIOUS_FILENAME,
    });
    const intentBody = (await intentResponse.json()) as IntentResponse;

    const expectedKeyPattern = new RegExp(
      `^uploads/${userId}/[0-9a-f-]{36}\\.png$`,
    );
    const keyFromServer: 0 | 1 =
      typeof intentBody.key === 'string' &&
      expectedKeyPattern.test(intentBody.key) &&
      !intentBody.key.includes('..') &&
      !intentBody.key.includes('etc') &&
      !intentBody.key.includes('passwd')
        ? 1
        : 0;

    // 2. Commit without uploading bytes -> must fail with 4xx (HeadObject 404 -> 409)
    const missingBytesIntent = await requestIntent(
      PORT_BEFORE_STOP,
      accessToken,
      {
        contentType: CONTENT_TYPE,
        size: PAYLOAD.byteLength,
        filename: 'never-uploaded.png',
      },
    );
    const missingBytesBody =
      (await missingBytesIntent.json()) as IntentResponse;

    const commitWithoutBytesResponse = await requestCommit(
      PORT_BEFORE_STOP,
      accessToken,
      missingBytesBody.fileId,
    );
    await commitWithoutBytesResponse.arrayBuffer();

    // 3. Stop the API and prove the port is dead via raw TCP socket (not fetch)
    await stopApplication(app);
    app = undefined;

    const apiAlive: 0 | 1 = (await isPortListening(PORT_BEFORE_STOP)) ? 1 : 0;

    // 4. Upload bytes from a separate keyless process while our API is completely down
    const putOffline = await runKeylessPut(
      intentBody.uploadUrl,
      CONTENT_TYPE,
      PAYLOAD,
    );

    // 5. Tamper with the key in the presigned URL -> 403 SignatureDoesNotMatch
    const tamperedUrl = tamperPresignedKey(
      intentBody.uploadUrl,
      intentBody.key,
    );
    const tampered = await runKeylessPut(tamperedUrl, CONTENT_TYPE, PAYLOAD);

    // 6. Verify expired presigned URL returns 403
    const expiredUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: `uploads/${userId}/expired-probe.png`,
        ContentType: CONTENT_TYPE,
      }),
      { expiresIn: 1 },
    );
    await delay(2_100);
    const expired = await runKeylessPut(expiredUrl, CONTENT_TYPE, PAYLOAD);

    // 7. Restart API on a DIFFERENT port (avoid dead keep-alive socket pool in fetch)
    app = startApplication(PORT_AFTER_RESTART);
    await waitUntilReady(app, PORT_AFTER_RESTART);

    const commitResponse = await requestCommit(
      PORT_AFTER_RESTART,
      accessToken,
      intentBody.fileId,
    );
    await commitResponse.arrayBuffer();

    const committedRow = await dataSource.getRepository(FileRecord).findOneBy({
      id: intentBody.fileId,
    });
    if (!committedRow || committedRow.status !== FileStatus.COMPLETED) {
      throw new Error(
        `Expected DB row ${intentBody.fileId} to be COMPLETED, got ${committedRow?.status ?? 'missing'}`,
      );
    }

    const metrics: UploadDemoMetrics = {
      intent: intentResponse.status,
      keyFromServer,
      apiAlive,
      putOffline,
      commit: commitResponse.status,
      commitWithoutBytes: commitWithoutBytesResponse.status,
      tampered,
      expired,
    };

    printMetrics(metrics);
    assertMetrics(metrics);
  } finally {
    if (app) {
      await stopApplication(app);
    }

    if (userId) {
      await resetDemoState(s3, bucket, userId).catch(() => undefined);
    }

    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }

    s3.destroy();
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

  const prefix = `uploads/${userId}/`;
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
}

async function login(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/auth/login`, {
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

function requestIntent(
  port: number,
  accessToken: string,
  payload: { contentType: string; size: number; filename: string },
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/uploads/intent`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
  });
}

function requestCommit(
  port: number,
  accessToken: string,
  fileId: string,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/uploads/commit`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ fileId }),
    signal: AbortSignal.timeout(5_000),
  });
}

function tamperPresignedKey(uploadUrl: string, originalKey: string): string {
  const parsed = new URL(uploadUrl);
  const tamperedKey = `${originalKey}.tampered`;
  if (!parsed.pathname.includes(originalKey)) {
    throw new Error('Presigned URL pathname did not contain expected key');
  }
  parsed.pathname = parsed.pathname.replace(originalKey, tamperedKey);
  return parsed.toString();
}

async function runKeylessPut(
  url: string,
  contentType: string,
  body: Buffer,
): Promise<number> {
  const script = `
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { raw += chunk; });
    process.stdin.on('end', async () => {
      const { url, contentType, bodyBase64 } = JSON.parse(raw);
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': contentType },
        body: Buffer.from(bodyBase64, 'base64'),
        signal: AbortSignal.timeout(10000),
      });
      await res.arrayBuffer();
      process.stdout.write(String(res.status));
    });
  `;

  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], {
      // Stripped environment: zero STORAGE_* or AWS_* credentials available.
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
        reject(new Error(`Keyless PUT exited with code ${code}: ${stderr}`));
        return;
      }

      const status = Number.parseInt(stdout.trim(), 10);
      if (!Number.isInteger(status)) {
        reject(new Error(`Invalid HTTP status from keyless PUT: ${stdout}`));
        return;
      }

      resolve(status);
    });

    child.stdin.end(
      JSON.stringify({
        url,
        contentType,
        bodyBase64: body.toString('base64'),
      }),
    );
  });
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });

    const done = (alive: boolean) => {
      socket.destroy();
      resolve(alive);
    };

    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
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

function printMetrics(m: UploadDemoMetrics): void {
  console.log(`intent=${m.intent}`);
  console.log(`key-from-server=${m.keyFromServer}`);
  console.log(`api-alive=${m.apiAlive}`);
  console.log(`put-offline=${m.putOffline}`);
  console.log(`commit=${m.commit}`);
  console.log(`commit-without-bytes=${m.commitWithoutBytes}`);
  console.log(`tampered=${m.tampered}`);
  console.log(`expired=${m.expired}`);
}

function assertMetrics(m: UploadDemoMetrics): void {
  const checks: Array<[string, boolean, string]> = [
    ['intent', m.intent === 200, `expected 200, got ${m.intent}`],
    [
      'key-from-server',
      m.keyFromServer === 1,
      `expected 1, got ${m.keyFromServer}`,
    ],
    ['api-alive', m.apiAlive === 0, `expected 0, got ${m.apiAlive}`],
    [
      'put-offline',
      m.putOffline === 200,
      `expected 200, got ${m.putOffline}`,
    ],
    ['commit', m.commit === 200, `expected 200, got ${m.commit}`],
    [
      'commit-without-bytes',
      m.commitWithoutBytes >= 400 && m.commitWithoutBytes < 500,
      `expected 4xx, got ${m.commitWithoutBytes}`,
    ],
    ['tampered', m.tampered === 403, `expected 403, got ${m.tampered}`],
    ['expired', m.expired === 403, `expected 403, got ${m.expired}`],
  ];

  const failures = checks
    .filter(([, ok]) => !ok)
    .map(([name, , detail]) => `${name}: ${detail}`);

  if (failures.length > 0) {
    throw new Error(`Upload demo invariant failed: ${failures.join('; ')}`);
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
