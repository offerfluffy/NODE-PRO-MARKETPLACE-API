import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../../config/env.schema.js';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly client: S3Client;
  private readonly bucket: string;
  private bucketReady?: Promise<void>;

  constructor(config: ConfigService<Env, true>) {
    const endpoint = config.get('STORAGE_ENDPOINT', { infer: true });

    this.bucket = config.get('STORAGE_BUCKET', { infer: true });
    this.client = new S3Client({
      region: config.get('STORAGE_REGION', { infer: true }),
      endpoint,
      forcePathStyle: Boolean(endpoint),
      credentials: {
        accessKeyId: config.get('STORAGE_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('STORAGE_SECRET_KEY', { infer: true }),
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  ensureBucket(): Promise<void> {
    this.bucketReady ??= this.ensureBucketOnce().catch((error: unknown) => {
      this.bucketReady = undefined;
      throw error;
    });

    return this.bucketReady;
  }

  private async ensureBucketOnce(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error: unknown) {
      if (!isNotFoundError(error)) {
        throw error;
      }

      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
      } catch (createError: unknown) {
        if (!(
          createError instanceof S3ServiceException &&
          createError.$metadata.httpStatusCode === 409
        )) {
          throw createError;
        }
      }
    }
  }

  async presignPut(params: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string> {
    await this.ensureBucket();

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ContentType: params.contentType,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: params.expiresInSeconds,
    });
  }

  async headObject(key: string): Promise<{
    size: number;
    etag: string | null;
    contentType: string | null;
  } | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      return {
        size: res.ContentLength ?? 0,
        etag: res.ETag ?? null,
        contentType: res.ContentType ?? null,
      };
    } catch (error: unknown) {
      if (!isNotFoundError(error)) {
        throw error;
      }

      return null;
    }
  }

  onModuleDestroy() {
    this.client.destroy();
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    error.$metadata.httpStatusCode === 404
  );
}
