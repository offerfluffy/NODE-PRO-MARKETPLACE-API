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
}
