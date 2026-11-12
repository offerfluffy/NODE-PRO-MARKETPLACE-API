import { Injectable } from '@nestjs/common';
import { ProductCardRepository } from '../database/repositories/product-card.repository.js';
import {
  productCardSchema,
  type ProductCardDto,
} from './dto/product-card.dto.js';
import { ProductCardCacheService } from './product-card-cache.service.js';

@Injectable()
export class ProductCardService {
  constructor(
    private readonly productCardRepository: ProductCardRepository,
    private readonly productCardCacheService: ProductCardCacheService,
  ) {}

  async findById(id: string): Promise<ProductCardDto | null> {
    const cacheRecord = await this.productCardCacheService.get(id);
    if (cacheRecord !== null) return cacheRecord;

    const record = await this.productCardRepository.findById(id);
    if (!record) return null;

    const product = productCardSchema.parse(record);
    await this.productCardCacheService.set(product);

    return product;
  }
}
