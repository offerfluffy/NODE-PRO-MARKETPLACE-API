import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OrderPostProcessingQueueService } from './order-post-processing-queue.service.js';

@Module({
  imports: [ConfigModule],
  providers: [OrderPostProcessingQueueService],
  exports: [OrderPostProcessingQueueService],
})
export class JobsModule {}
