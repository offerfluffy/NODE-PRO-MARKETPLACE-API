import { createHash } from 'node:crypto';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

export const IMMUTABLE_ASSET_CACHE_CONTROL =
  'public, max-age=31536000, immutable';

export type PublishVersionedAssetInput = {
  s3: S3Client;
  bucket: string;
  baseName: string;
  extension: string;
  contentType: string;
  body: Buffer | string;
};

export type PublishVersionedAssetResult = {
  key: string;
  hash: string;
  cacheControl: string;
};

export async function publishVersionedAsset({
  s3,
  bucket,
  baseName,
  extension,
  contentType,
  body,
}: PublishVersionedAssetInput): Promise<PublishVersionedAssetResult> {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 8);
  const key = `assets/${baseName}.${hash}.${extension}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: IMMUTABLE_ASSET_CACHE_CONTROL,
    }),
  );

  return {
    key,
    hash,
    cacheControl: IMMUTABLE_ASSET_CACHE_CONTROL,
  };
}
