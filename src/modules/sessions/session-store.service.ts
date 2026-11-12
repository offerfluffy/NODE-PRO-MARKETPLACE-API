import { Inject, Injectable } from '@nestjs/common';
import { DURABLE_REDIS } from '../redis/redis.tokens.js';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { postgresBigintIdSchema } from '../orders/dto/create-order.dto.js';
import { randomUUID } from 'node:crypto';

const SESSION_TTL_SECONDS = 1800;

const sessionDataSchema = z.object({
  userId: postgresBigintIdSchema,
});

export type SessionData = z.infer<typeof sessionDataSchema>;

@Injectable()
export class SessionStoreService {
  constructor(
    @Inject(DURABLE_REDIS)
    private readonly durableRedis: Redis,
  ) {}

  private key(sessionId: string): string {
    return `session:${sessionId}`;
  }

  async create(data: SessionData): Promise<string> {
    const validatedData = sessionDataSchema.parse(data);
    const sessionId = randomUUID();

    await this.durableRedis.set(
      this.key(sessionId),
      JSON.stringify(validatedData),
      'EX',
      SESSION_TTL_SECONDS,
    );

    return sessionId;
  }
}
