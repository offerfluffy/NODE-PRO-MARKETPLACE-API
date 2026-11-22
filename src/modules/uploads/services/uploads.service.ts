import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ALLOWED_CONTENT_TYPES,
  PRESIGNED_PUT_EXPIRES_IN_SECONDS,
  type AllowedContentType,
} from '../upload-policy.js';
import { FilesRepository } from '../../database/repositories/files.repository.js';
import { StorageService } from './storage.service.js';
import { FileStatus } from '../../database/entities/file.entity.js';

export type CreateUploadIntentInput = {
  userId: string;
  contentType: AllowedContentType;
  size: number;
};

export type CreateUploadIntentResult = {
  fileId: string;
  key: string;
  uploadUrl: string;
  expiresIn: number;
};

export type CommitUploadInput = {
  userId: string;
  fileId: string;
};

export type CommitUploadResult = {
  fileId: string;
  key: string;
  status: FileStatus;
  size: string;
  etag: string | null;
};

@Injectable()
export class UploadsService {
  constructor(
    private readonly filesRepository: FilesRepository,
    private readonly storageService: StorageService,
  ) {}

  async createIntent({
    userId,
    contentType,
    size,
  }: CreateUploadIntentInput): Promise<CreateUploadIntentResult> {
    const ext = ALLOWED_CONTENT_TYPES[contentType];
    const key = `uploads/${userId}/${randomUUID()}.${ext}`;

    const file = await this.filesRepository.createPending({
      key,
      ownerId: userId,
      contentType,
      size: String(size),
    });

    const uploadUrl = await this.storageService.presignPut({
      key,
      contentType,
      expiresInSeconds: PRESIGNED_PUT_EXPIRES_IN_SECONDS,
    });

    return {
      fileId: file.id,
      key,
      uploadUrl,
      expiresIn: PRESIGNED_PUT_EXPIRES_IN_SECONDS,
    };
  }

  async commit({
    userId,
    fileId,
  }: CommitUploadInput): Promise<CommitUploadResult> {
    const file = await this.filesRepository.findById(fileId);

    if (!file) {
      throw new NotFoundException(`File ${fileId} was not found`);
    }
    if (file.ownerId !== userId) {
      throw new ForbiddenException('The file does not belong to this user');
    }
    if (file.status === FileStatus.COMPLETED) {
      return {
        fileId: file.id,
        key: file.key,
        status: file.status,
        size: file.size,
        etag: file.etag,
      };
    }

    const head = await this.storageService.headObject(file.key);

    if (!head) {
      throw new ConflictException('Uploaded object was not found in storage');
    }
    if (BigInt(head.size) !== BigInt(file.size)) {
      throw new ConflictException(
        'Uploaded object size does not match expected size',
      );
    }

    const result = await this.filesRepository.markCompleted(fileId, {
      size: String(head.size),
      etag: head.etag,
    });

    if (!result) {
      throw new NotFoundException(`File ${fileId} was not found`);
    }

    return {
      fileId: result.id,
      key: result.key,
      status: result.status,
      size: result.size,
      etag: result.etag,
    };
  }
}
