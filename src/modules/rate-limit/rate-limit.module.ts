import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module.js';
import { RateLimitService } from './rate-limit.service.js';
import { ProductRateLimitGuard } from './product-rate-limit.guard.js';

@Module({
  imports: [RedisModule],
  providers: [RateLimitService, ProductRateLimitGuard],
  exports: [RateLimitService, ProductRateLimitGuard],
})
export class RateLimitModule {}
