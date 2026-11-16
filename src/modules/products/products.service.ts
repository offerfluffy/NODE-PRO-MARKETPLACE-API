import { Injectable } from '@nestjs/common';
import {
  ProductsRepository,
  type CreateProductInput,
} from '../database/repositories/products.repository.js';

@Injectable()
export class ProductsService {
  constructor(private readonly productsRepository: ProductsRepository) {}

  async create(input: CreateProductInput): Promise<{ id: string }> {
    const product = await this.productsRepository.createWithInventory(input);

    return {
      id: product.id,
    };
  }
}
