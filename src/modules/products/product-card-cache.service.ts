import { randomInt, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CACHE_REDIS } from '../redis/redis.tokens.js';
import {
  productCardSchema,
  type ProductCardDto,
} from './dto/product-card.dto.js';
import { UNLOCK_LUA } from '../redis/redis.scripts.js';

const BASE_TTL_SECONDS = 300;
const TTL_JITTER_SECONDS = 60;
const LOCK_TTL_MS = 5000;

@Injectable()
export class ProductCardCacheService {
  private readonly logger = new Logger(ProductCardCacheService.name);

  constructor(
    @Inject(CACHE_REDIS)
    private readonly cacheRedis: Redis,
  ) {}

  private key(id: string): string {
    return `product-card:v1:${id}`;
  }

  private lockKey(id: string): string {
    return `lock:product-card:v1:${id}`;
  }

  async get(id: string): Promise<ProductCardDto | null> {
    const key = this.key(id);

    try {
      const record = await this.cacheRedis.get(key);

      if (record === null) {
        return null;
      }

      return productCardSchema.parse(JSON.parse(record));
    } catch (error) {
      this.logger.warn(
        `Product-card cache read failed for ${id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return null;
    }
  }

  async set(product: ProductCardDto): Promise<void> {
    const ttl = BASE_TTL_SECONDS + randomInt(0, TTL_JITTER_SECONDS + 1);

    try {
      await this.cacheRedis.set(
        this.key(product.id),
        JSON.stringify(product),
        'EX',
        ttl,
      );
    } catch (error) {
      this.logger.warn(
        `Product-card cache set failed for ${product.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async acquireLock(id: string): Promise<string | null> {
    const token = randomUUID();

    try {
      const result = await this.cacheRedis.set(
        this.lockKey(id),
        token,
        'PX',
        LOCK_TTL_MS,
        'NX',
      );

      return result === 'OK' ? token : null;
    } catch (error) {
      this.logger.warn(
        `Product-card lock acquire failed for ${id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return null;
    }
  }

  async releaseLock(id: string, token: string): Promise<void> {
    try {
      await this.cacheRedis.eval(UNLOCK_LUA, 1, this.lockKey(id), token);
    } catch (error) {
      this.logger.warn(
        `Product-card lock release failed for ${id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
