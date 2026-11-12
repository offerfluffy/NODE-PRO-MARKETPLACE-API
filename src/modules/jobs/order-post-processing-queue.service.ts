import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env.schema.js';
import {
  ORDER_POST_PROCESSING_JOB,
  ORDER_POST_PROCESSING_QUEUE,
  orderPostProcessingJobId,
  type OrderPostProcessingJobData,
} from './order-post-processing.queue.js';

@Injectable()
export class OrderPostProcessingQueueService implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<OrderPostProcessingJobData>;

  constructor(private readonly config: ConfigService<Env, true>) {
    const redisUrl = this.config.get('REDIS_QUEUE_URL', {
      infer: true,
    });

    this.connection = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
    });
    this.queue = new Queue<OrderPostProcessingJobData>(
      ORDER_POST_PROCESSING_QUEUE,
      {
        connection: this.connection,
      },
    );
  }

  async enqueue(data: OrderPostProcessingJobData): Promise<void> {
    await this.queue.add(ORDER_POST_PROCESSING_JOB, data, {
      jobId: orderPostProcessingJobId(data.orderId),
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 500,
        jitter: 0.5,
      },
      removeOnComplete: {
        age: 24 * 60 * 60,
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60,
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.queue.close();
    } finally {
      await this.connection.quit();
    }
  }
}
