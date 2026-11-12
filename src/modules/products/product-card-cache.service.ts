import { randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CACHE_REDIS } from '../redis/redis.tokens.js';
import {
  productCardSchema,
  type ProductCardDto,
} from './dto/product-card.dto.js';

const BASE_TTL_SECONDS = 300;
const TTL_JITTER_SECONDS = 60;

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
}
