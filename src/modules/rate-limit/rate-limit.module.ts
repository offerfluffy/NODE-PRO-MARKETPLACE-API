import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module.js';
import { RateLimitService } from './rate-limit.service.js';

@Module({
  imports: [RedisModule],
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
