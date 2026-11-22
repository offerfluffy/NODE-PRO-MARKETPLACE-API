import { DataSource, Repository } from 'typeorm';
import { FileRecord, FileStatus } from '../entities/file.entity.js';

export type CreatePendingFileInput = {
  key: string;
  ownerId: string;
  contentType: string;
  size: string;
  uploadId?: string | null;
};

export type CompleteFileInput = {
  size: string;
  etag: string | null;
};

export class FilesRepository {
  private readonly files: Repository<FileRecord>;

  constructor(dataSource: DataSource) {
    this.files = dataSource.getRepository(FileRecord);
  }

  async createPending(input: CreatePendingFileInput): Promise<FileRecord> {
    const record = this.files.create({
      key: input.key,
      ownerId: input.ownerId,
      status: FileStatus.PENDING,
      contentType: input.contentType,
      size: input.size,
      uploadId: input.uploadId ?? null,
      etag: null,
    });

    return this.files.save(record);
  }

  findById(id: string): Promise<FileRecord | null> {
    return this.files.findOneBy({ id });
  }

  async markCompleted(
    id: string,
    input: CompleteFileInput,
  ): Promise<FileRecord | null> {
    const result = await this.files
      .createQueryBuilder()
      .update(FileRecord)
      .set({
        status: FileStatus.COMPLETED,
        size: input.size,
        etag: input.etag,
      })
      .where('id = :id', { id })
      .returning('*')
      .execute();

    const raw = result.raw[0] as
      | {
          id: string;
          key: string;
          owner_id: string;
          status: FileStatus;
          content_type: string;
          size: string;
          upload_id: string | null;
          etag: string | null;
          created_at: Date;
          updated_at: Date;
        }
      | undefined;

    if (!raw) {
      return null;
    }

    return this.files.create({
      id: raw.id,
      key: raw.key,
      ownerId: raw.owner_id,
      status: raw.status,
      contentType: raw.content_type,
      size: raw.size,
      uploadId: raw.upload_id,
      etag: raw.etag,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    });
  }
}
