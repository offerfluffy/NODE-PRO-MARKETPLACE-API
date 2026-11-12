import { randomUUID } from 'node:crypto';
import { SLIDING_WINDOW_LUA } from '../redis/redis.scripts.js';
import { Inject, Injectable } from '@nestjs/common';
import { DURABLE_REDIS } from '../redis/redis.tokens.js';
import type { Redis } from 'ioredis';

export const RATE_LIMIT = 5;
export const RATE_WINDOW_MS = 10_000;

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

@Injectable()
export class RateLimitService {
  constructor(
    @Inject(DURABLE_REDIS)
    private readonly durableRedis: Redis,
  ) {}

  private key(clientId: string): string {
    return `rate-limit:product-card:${clientId}`;
  }

  async consume(clientId: string): Promise<RateLimitDecision> {
    const result = await this.durableRedis.eval(
      SLIDING_WINDOW_LUA,
      1,
      this.key(clientId),
      Date.now(),
      RATE_WINDOW_MS,
      RATE_LIMIT,
      randomUUID(),
    );

    return {
      allowed: Number(result) === 1,
      retryAfterSeconds: Math.ceil(RATE_WINDOW_MS / 1000),
    };
  }

  async reset(clientId: string): Promise<void> {
    await this.durableRedis.del(this.key(clientId));
  }
}
