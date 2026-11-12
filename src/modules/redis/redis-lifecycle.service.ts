import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { CACHE_REDIS, DURABLE_REDIS } from './redis.tokens.js';
import type { Redis } from 'ioredis';

@Injectable()
export class RedisLifecycleService implements OnApplicationShutdown {
  constructor(
    @Inject(CACHE_REDIS)
    private readonly cacheRedis: Redis,
    @Inject(DURABLE_REDIS)
    private readonly durableRedis: Redis,
  ) {}

  async onApplicationShutdown() {
    await Promise.allSettled([
      this.cacheRedis.quit(),
      this.durableRedis.quit(),
    ]);
  }
}
