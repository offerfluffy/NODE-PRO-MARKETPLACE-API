import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

type OrderPostProcessingPayload = {
  orderId: string;
  customerId: string;
};

@Entity('jobs')
@Check('CHK_jobs_status', `"status" IN ('pending', 'done')`)
@Check('CHK_jobs_processed_positive_or_zero', `"processed" >= 0`)
@Index('idx_jobs_status_id', ['status', 'id'])
export class Job {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id!: string;

  @Column({ type: 'text' })
  type!: string;

  @Column({ type: 'jsonb' })
  payload!: OrderPostProcessingPayload;

  @Column({ type: 'text', default: 'pending' })
  status!: string;

  @Column({ type: 'integer', default: 0 })
  processed!: number;

  @Column({ type: 'text', nullable: true })
  worker: string | null;

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
