import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import type { Env } from '../../config/env.schema.js';
import {
  ORDER_POST_PROCESSING_QUEUE,
  type OrderPostProcessingJobData,
} from './order-post-processing.queue.js';

@Injectable()
export class OrderPostProcessingWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OrderPostProcessingWorker.name);
  private connection: Redis | undefined;
  private worker: Worker<OrderPostProcessingJobData> | undefined;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    const redisUrl = this.config.get('REDIS_QUEUE_URL', {
      infer: true,
    });
    const connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
    });
    const worker = new Worker<OrderPostProcessingJobData>(
      ORDER_POST_PROCESSING_QUEUE,
      (job) => this.process(job),
      { connection },
    );

    worker.on('error', (error: Error) => {
      this.logger.error('BullMQ worker error', error.stack);
    });

    this.connection = connection;
    this.worker = worker;
  }

  private async process(job: Job<OrderPostProcessingJobData>): Promise<void> {
    await this.dataSource.query(
      `
        UPDATE jobs
        SET status = 'done',
            processed = processed + 1,
            worker = $2,
            updated_at = NOW()
        WHERE event_id = $1
          AND status = 'pending'
      `,
      [job.data.eventId, `bullmq:${job.id ?? job.data.orderId}`],
    );
  }

  async onModuleDestroy(): Promise<void> {
    const worker = this.worker;
    const connection = this.connection;

    this.worker = undefined;
    this.connection = undefined;

    try {
      await worker?.close();
    } finally {
      await connection?.quit();
    }
  }
}
