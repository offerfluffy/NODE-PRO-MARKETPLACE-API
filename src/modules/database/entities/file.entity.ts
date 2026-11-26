import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity.js';

export enum FileStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
}

@Entity('files')
@Check('CHK_files_status', `"status" IN ('PENDING', 'COMPLETED')`)
@Check('CHK_files_size_positive', `"size" > 0`)
@Index('UQ_files_key', ['key'], { unique: true })
@Index('idx_files_owner_id', ['ownerId'])
@Index('idx_files_status_created_at', ['status', 'createdAt'])
export class FileRecord {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id!: string;

  @Column({ type: 'text' })
  key!: string;

  @Column({ name: 'owner_id', type: 'bigint' })
  ownerId!: string;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'owner_id' })
  owner!: Relation<User>;

  @Column({ type: 'text', default: FileStatus.PENDING })
  status!: FileStatus;

  @Column({ name: 'content_type', type: 'text' })
  contentType!: string;

  @Column({ type: 'bigint' })
  size!: string;

  @Column({ name: 'upload_id', type: 'text', nullable: true })
  uploadId!: string | null;

  @Column({ type: 'text', nullable: true })
  etag!: string | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt!: Date;
}
