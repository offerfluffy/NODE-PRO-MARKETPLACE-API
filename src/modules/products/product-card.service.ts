import { setTimeout as delay } from 'node:timers/promises';
import { Injectable } from '@nestjs/common';
import { ProductCardRepository } from '../database/repositories/product-card.repository.js';
import {
  productCardSchema,
  type ProductCardDto,
} from './dto/product-card.dto.js';
import { ProductCardCacheService } from './product-card-cache.service.js';

const WAITER_ATTEMPTS = 20;
const WAITER_DELAY_MS = 50;

@Injectable()
export class ProductCardService {
  constructor(
    private readonly productCardRepository: ProductCardRepository,
    private readonly productCardCacheService: ProductCardCacheService,
  ) {}

  async findById(id: string): Promise<ProductCardDto | null> {
    const cacheRecord = await this.productCardCacheService.get(id);
    if (cacheRecord !== null) return cacheRecord;

    const token = await this.productCardCacheService.acquireLock(id);

    if (token === null) {
      const waitedProduct = await this.waitForCachedProduct(id);

      if (waitedProduct !== null) {
        return waitedProduct;
      }

      return this.loadFromDatabase(id);
    }

    try {
      const rechecked = await this.productCardCacheService.get(id);
      if (rechecked !== null) return rechecked;

      return await this.loadFromDatabase(id);
    } finally {
      await this.productCardCacheService.releaseLock(id, token);
    }
  }

  private async loadFromDatabase(id: string): Promise<ProductCardDto | null> {
    const record = await this.productCardRepository.findById(id);
    if (!record) return null;

    const product = productCardSchema.parse(record);
    await this.productCardCacheService.set(product);

    return product;
  }

  private async waitForCachedProduct(
    id: string,
  ): Promise<ProductCardDto | null> {
    for (let attempt = 0; attempt < WAITER_ATTEMPTS; attempt += 1) {
      await delay(WAITER_DELAY_MS);

      const product = await this.productCardCacheService.get(id);

      if (product !== null) {
        return product;
      }
    }

    return null;
  }
}
