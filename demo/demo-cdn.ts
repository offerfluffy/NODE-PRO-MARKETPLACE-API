import type { Server } from 'node:http';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { publishVersionedAsset } from '../src/modules/cdn/asset-publisher.js';
import { createEdgeCacheServer } from '../src/modules/cdn/edge-cache-server.js';

const EDGE_PORT = 21_264;
const EDGE_BASE_URL = `http://127.0.0.1:${EDGE_PORT}`;
const ASSETS_PREFIX = 'assets/';
const CSS_V1 = 'body { color: #111; background: #fff; }\n';
const CSS_V2 = 'body { color: #0f172a; background: #f8fafc; }\n';

type CdnDemoMetrics = {
  direct: number;
  edgeMiss: number;
  edgeHit: number;
  cacheHit: 0 | 1;
  newName: 0 | 1;
  newUrl: number;
  contentChanged: 0 | 1;
};

async function main(): Promise<void> {
  const bucket = requiredEnv('STORAGE_BUCKET');
  const region = process.env.STORAGE_REGION?.trim() || 'us-east-1';
  const endpoint = process.env.STORAGE_ENDPOINT?.trim() || undefined;
  const s3 = createS3Client(region, endpoint);

  let edgeServer: Server | undefined;

  try {
    await ensureBucket(s3, bucket);
    await clearAssetsPrefix(s3, bucket);

    edgeServer = createEdgeCacheServer({
      s3,
      bucket,
      allowedPrefix: ASSETS_PREFIX,
    });
    await listen(edgeServer, EDGE_PORT);

    // 1. Publish v1 asset with content hash in key & immutable Cache-Control on origin
    const v1 = await publishVersionedAsset({
      s3,
      bucket,
      baseName: 'app',
      extension: 'css',
      contentType: 'text/css; charset=utf-8',
      body: CSS_V1,
    });

    // 2. Direct anonymous GET to storage must fail with 403 (private bucket)
    const directUrl = buildDirectObjectUrl({ endpoint, region, bucket, key: v1.key });
    const directRes = await fetch(directUrl, {
      signal: AbortSignal.timeout(5_000),
    });
    await directRes.arrayBuffer();

    // 3. First GET through edge -> MISS (fetched from private bucket via OAC-like SDK credentials)
    const missRes = await fetch(`${EDGE_BASE_URL}/${v1.key}`, {
      signal: AbortSignal.timeout(5_000),
    });
    const missBody = await missRes.text();
    const missCacheHeader = missRes.headers.get('x-cache')?.toUpperCase() ?? '';
    if (missCacheHeader !== 'MISS') {
      throw new Error(`Expected first edge request X-Cache=MISS, got "${missCacheHeader}"`);
    }

    // 4. Second GET through edge -> HIT (served from cache because origin set Cache-Control)
    const hitRes = await fetch(`${EDGE_BASE_URL}/${v1.key}`, {
      signal: AbortSignal.timeout(5_000),
    });
    const hitBody = await hitRes.text();
    const hitCacheHeader = hitRes.headers.get('x-cache')?.toUpperCase() ?? '';
    const cacheHit: 0 | 1 = hitCacheHeader.includes('HIT') ? 1 : 0;

    if (hitBody !== missBody || hitBody !== CSS_V1) {
      throw new Error('Cached v1 body did not match published v1 CSS');
    }

    // 5. "Deploy" v2 with updated content -> new hashed URL, zero cache invalidations
    const v2 = await publishVersionedAsset({
      s3,
      bucket,
      baseName: 'app',
      extension: 'css',
      contentType: 'text/css; charset=utf-8',
      body: CSS_V2,
    });

    const newName: 0 | 1 = v2.key !== v1.key ? 1 : 0;

    const v2Res = await fetch(`${EDGE_BASE_URL}/${v2.key}`, {
      signal: AbortSignal.timeout(5_000),
    });
    const v2Body = await v2Res.text();

    const contentChanged: 0 | 1 = v2Body === CSS_V2 && v2Body !== missBody ? 1 : 0;

    const metrics: CdnDemoMetrics = {
      direct: directRes.status,
      edgeMiss: missRes.status,
      edgeHit: hitRes.status,
      cacheHit,
      newName,
      newUrl: v2Res.status,
      contentChanged,
    };

    printMetrics(metrics);
    assertMetrics(metrics);
  } finally {
    if (edgeServer) {
      await closeServer(edgeServer);
    }

    await clearAssetsPrefix(s3, bucket).catch(() => undefined);
    s3.destroy();
  }
}

function buildDirectObjectUrl(params: {
  endpoint: string | undefined;
  region: string;
  bucket: string;
  key: string;
}): string {
  if (params.endpoint) {
    const base = params.endpoint.replace(/\/+$/, '');
    return `${base}/${params.bucket}/${params.key}`;
  }
  return `https://${params.bucket}.s3.${params.region}.amazonaws.com/${params.key}`;
}

function createS3Client(region: string, endpoint: string | undefined): S3Client {
  return new S3Client({
    region,
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

async function clearAssetsPrefix(s3: S3Client, bucket: string): Promise<void> {
  let continuationToken: string | undefined;

  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: ASSETS_PREFIX,
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

function listen(server: Server, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

function printMetrics(m: CdnDemoMetrics): void {
  console.log(`direct=${m.direct}`);
  console.log(`edge-miss=${m.edgeMiss}`);
  console.log(`edge-hit=${m.edgeHit}`);
  console.log(`cache-hit=${m.cacheHit}`);
  console.log(`new-name=${m.newName}`);
  console.log(`new-url=${m.newUrl}`);
  console.log(`content-changed=${m.contentChanged}`);
}

function assertMetrics(m: CdnDemoMetrics): void {
  const checks: Array<[string, boolean, string]> = [
    ['direct', m.direct === 403, `expected 403, got ${m.direct}`],
    ['edge-miss', m.edgeMiss === 200, `expected 200, got ${m.edgeMiss}`],
    ['edge-hit', m.edgeHit === 200, `expected 200, got ${m.edgeHit}`],
    ['cache-hit', m.cacheHit === 1, `expected 1, got ${m.cacheHit}`],
    ['new-name', m.newName === 1, `expected 1, got ${m.newName}`],
    ['new-url', m.newUrl === 200, `expected 200, got ${m.newUrl}`],
    [
      'content-changed',
      m.contentChanged === 1,
      `expected 1, got ${m.contentChanged}`,
    ],
  ];

  const failures = checks
    .filter(([, ok]) => !ok)
    .map(([name, , detail]) => `${name}: ${detail}`);

  if (failures.length > 0) {
    throw new Error(`CDN demo invariant failed: ${failures.join('; ')}`);
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
