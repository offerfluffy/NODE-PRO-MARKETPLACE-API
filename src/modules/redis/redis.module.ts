import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import { CACHE_REDIS, DURABLE_REDIS } from './redis.tokens.js';
import { Redis } from 'ioredis';

@Module({
  providers: [
    {
      provide: CACHE_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = config.get('REDIS_URL');
        return new Redis(url);
      },
    },
    {
      provide: DURABLE_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = config.get('REDIS_QUEUE_URL');
        return new Redis(url);
      },
    },
  ],
  exports: [CACHE_REDIS, DURABLE_REDIS],
})
export class RedisModule {}
