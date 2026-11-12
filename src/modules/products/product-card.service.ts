import { Injectable } from '@nestjs/common';
import { ProductCardRepository } from '../database/repositories/product-card.repository.js';
import {
  productCardSchema,
  type ProductCardDto,
} from './dto/product-card.dto.js';

@Injectable()
export class ProductCardService {
  constructor(private readonly productCardRepository: ProductCardRepository) {}

  async findById(id: string): Promise<ProductCardDto | null> {
    const record = await this.productCardRepository.findById(id);

    if (!record) return null;

    return productCardSchema.parse(record);
  }
}
