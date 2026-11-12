import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module.js';
import { OrderPostProcessingQueueService } from './order-post-processing-queue.service.js';
import { OrderPostProcessingWorker } from './order-post-processing.worker.js';

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [OrderPostProcessingQueueService, OrderPostProcessingWorker],
  exports: [OrderPostProcessingQueueService],
})
export class JobsModule {}
