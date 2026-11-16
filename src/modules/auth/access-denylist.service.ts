import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { DURABLE_REDIS } from '../redis/redis.tokens.js';
import type { AccessTokenClaims } from './auth.types.js';

@Injectable()
export class AccessDenylistService {
  constructor(
    @Inject(DURABLE_REDIS)
    private readonly redis: Redis,
  ) {}

  async revoke(claims: AccessTokenClaims): Promise<void> {
    const now = Math.floor(Date.now() / 1_000);
    const ttl = claims.exp - now;

    if (ttl <= 0) return;

    await this.redis.set(this.key(claims), '1', 'EX', ttl);
  }

  async isRevoked(claims: AccessTokenClaims): Promise<boolean> {
    return (await this.redis.exists(this.key(claims))) === 1;
  }

  private key(claims: AccessTokenClaims): string {
    return `auth:deny:${claims.iss}:${claims.jti}`;
  }
}
