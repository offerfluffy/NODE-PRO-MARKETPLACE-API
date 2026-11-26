import http, { type Server } from 'node:http';
import {
  GetObjectCommand,
  S3ServiceException,
  type S3Client,
} from '@aws-sdk/client-s3';

export type EdgeCacheServerOptions = {
  s3: S3Client;
  bucket: string;
  allowedPrefix?: string;
};

type CacheEntry = {
  body: Buffer;
  contentType: string;
  cacheControl: string;
  etag?: string;
  expiresAt: number;
};

export function createEdgeCacheServer(options: EdgeCacheServerOptions): Server {
  const { s3, bucket, allowedPrefix = 'assets/' } = options;
  const cache = new Map<string, CacheEntry>();

  return http.createServer((req, res) => {
    void handleRequest(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Bad Gateway');
      }
    });
  });

  async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    const key = decodeURIComponent(
      new URL(req.url ?? '/', 'http://127.0.0.1').pathname,
    ).replace(/^\/+/, '');

    if (
      !key ||
      key.includes('..') ||
      (allowedPrefix && !key.startsWith(allowedPrefix))
    ) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      sendObject(res, req.method, cached, 'HIT');
      return;
    }

    let obj;
    try {
      obj = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
    } catch (error: unknown) {
      if (
        error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === 404
      ) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      throw error;
    }

    const body = obj.Body
      ? Buffer.from(await obj.Body.transformToByteArray())
      : Buffer.alloc(0);
    const contentType = obj.ContentType ?? 'application/octet-stream';
    const cacheControl = obj.CacheControl ?? '';
    const etag = obj.ETag;

    const entry: CacheEntry = {
      body,
      contentType,
      cacheControl,
      etag,
      expiresAt: 0,
    };

    const maxAgeSeconds = parseCacheableMaxAgeSeconds(cacheControl);
    if (maxAgeSeconds !== null) {
      entry.expiresAt = Date.now() + maxAgeSeconds * 1_000;
      cache.set(key, entry);
    }

    sendObject(res, req.method, entry, 'MISS');
  }
}

function sendObject(
  res: http.ServerResponse,
  method: string,
  entry: CacheEntry,
  cacheState: 'HIT' | 'MISS',
): void {
  const headers: Record<string, string> = {
    'content-type': entry.contentType,
    'content-length': String(entry.body.byteLength),
    'x-cache': cacheState,
  };

  if (entry.cacheControl) {
    headers['cache-control'] = entry.cacheControl;
  }
  if (entry.etag) {
    headers.etag = entry.etag;
  }

  res.writeHead(200, headers);
  res.end(method === 'HEAD' ? undefined : entry.body);
}

export function parseCacheableMaxAgeSeconds(
  cacheControl: string | undefined,
): number | null {
  if (!cacheControl) {
    return null;
  }

  const normalized = cacheControl.toLowerCase();
  if (
    normalized.includes('no-store') ||
    normalized.includes('no-cache') ||
    normalized.includes('private')
  ) {
    return null;
  }

  const match =
    normalized.match(/\bs-maxage=(\d+)\b/) ??
    normalized.match(/\bmax-age=(\d+)\b/);

  if (!match) {
    return null;
  }

  const seconds = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}
