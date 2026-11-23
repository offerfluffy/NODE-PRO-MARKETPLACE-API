import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ALLOWED_CONTENT_TYPES,
  calculatePartSize,
  MULTIPART_THRESHOLD_BYTES,
  PRESIGNED_PUT_EXPIRES_IN_SECONDS,
  type AllowedContentType,
} from '../upload-policy.js';
import { FilesRepository } from '../../database/repositories/files.repository.js';
import { StorageService, type UploadedPart } from './storage.service.js';
import { FileStatus } from '../../database/entities/file.entity.js';

export type CreateUploadIntentInput = {
  userId: string;
  contentType: AllowedContentType;
  size: number;
};

export type MultipartPartTarget = {
  partNumber: number;
  uploadUrl: string;
};

export type CreateUploadIntentResult =
  | {
      mode: 'single';
      fileId: string;
      key: string;
      uploadUrl: string;
      expiresIn: number;
    }
  | {
      mode: 'multipart';
      fileId: string;
      key: string;
      uploadId: string;
      partSize: number;
      partCount: number;
      parts: MultipartPartTarget[];
      expiresIn: number;
    };

export type CommitUploadInput = {
  userId: string;
  fileId: string;
};

export type GetUploadPartsInput = {
  userId: string;
  fileId: string;
};

export type GetUploadPartsResult = {
  fileId: string;
  key: string;
  uploadId: string;
  partSize: number;
  partCount: number;
  uploadedParts: UploadedPart[];
  missingParts: MultipartPartTarget[];
  expiresIn: number;
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

    if (size <= MULTIPART_THRESHOLD_BYTES) {
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
        mode: 'single',
        fileId: file.id,
        key,
        uploadUrl,
        expiresIn: PRESIGNED_PUT_EXPIRES_IN_SECONDS,
      };
    }

    const uploadId = await this.storageService.createMultipartUpload({
      key,
      contentType,
    });

    let file;
    try {
      file = await this.filesRepository.createPending({
        key,
        ownerId: userId,
        contentType,
        size: String(size),
        uploadId,
      });
    } catch (error: unknown) {
      await this.storageService
        .abortMultipartUpload({ key, uploadId })
        .catch(() => undefined);
      throw error;
    }

    const partSize = calculatePartSize(size);
    const partCount = Math.ceil(size / partSize);

    const parts: MultipartPartTarget[] = await Promise.all(
      Array.from({ length: partCount }, async (_, index) => {
        const partNumber = index + 1;
        const uploadUrl = await this.storageService.presignUploadPart({
          key,
          uploadId,
          partNumber,
          expiresInSeconds: PRESIGNED_PUT_EXPIRES_IN_SECONDS,
        });
        return { partNumber, uploadUrl };
      }),
    );

    return {
      mode: 'multipart',
      fileId: file.id,
      key,
      uploadId,
      partSize,
      partCount,
      parts,
      expiresIn: PRESIGNED_PUT_EXPIRES_IN_SECONDS,
    };
  }

  async getParts({
    userId,
    fileId,
  }: GetUploadPartsInput): Promise<GetUploadPartsResult> {
    const file = await this.filesRepository.findById(fileId);

    if (!file) {
      throw new NotFoundException(`File ${fileId} was not found`);
    }
    if (file.ownerId !== userId) {
      throw new ForbiddenException('The file does not belong to this user');
    }
    if (!file.uploadId) {
      throw new ConflictException('The file is not a multipart upload');
    }
    if (file.status === FileStatus.COMPLETED) {
      throw new ConflictException('Multipart upload is already completed');
    }

    const uploadId = file.uploadId;
    const uploadedParts = await this.storageService.listParts({
      key: file.key,
      uploadId,
    });

    const uploadedPartNumbers = new Set(
      uploadedParts.map((part) => part.partNumber),
    );
    const partSize = calculatePartSize(Number(file.size));
    const partCount = Math.ceil(Number(file.size) / partSize);

    const missingPartNumbers: number[] = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      if (!uploadedPartNumbers.has(partNumber)) {
        missingPartNumbers.push(partNumber);
      }
    }

    const missingParts: MultipartPartTarget[] = await Promise.all(
      missingPartNumbers.map(async (partNumber) => {
        const uploadUrl = await this.storageService.presignUploadPart({
          key: file.key,
          uploadId,
          partNumber,
          expiresInSeconds: PRESIGNED_PUT_EXPIRES_IN_SECONDS,
        });
        return { partNumber, uploadUrl };
      }),
    );

    return {
      fileId: file.id,
      key: file.key,
      uploadId,
      partSize,
      partCount,
      uploadedParts,
      missingParts,
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

    if (file.uploadId) {
      const expectedPartCount = Math.ceil(
        Number(file.size) / calculatePartSize(Number(file.size)),
      );
      const uploadedParts = await this.storageService.listParts({
        key: file.key,
        uploadId: file.uploadId,
      });
      if (uploadedParts.length < expectedPartCount) {
        throw new ConflictException(
          `Multipart upload is incomplete: ${uploadedParts.length}/${expectedPartCount} parts uploaded`,
        );
      }
      await this.storageService.completeMultipartUpload({
        key: file.key,
        uploadId: file.uploadId,
        parts: uploadedParts,
      });
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
