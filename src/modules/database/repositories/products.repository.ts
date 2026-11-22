import { DataSource } from 'typeorm';
import { Product, type ProductStatus } from '../entities/product.entity.js';
import { Inventory } from '../entities/inventory.entity.js';

export type CreateProductInput = {
  sellerId: string;
  name: string;
  description: string;
  priceCents: number;
  quantityAvailable: number;
  status: ProductStatus;
  imageUrl: string | null;
};

export class ProductsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async createWithInventory(input: CreateProductInput): Promise<Product> {
    return this.dataSource.transaction(async (manager) => {
      const products = manager.getRepository(Product);
      const inventories = manager.getRepository(Inventory);

      const product = await products.save(
        products.create({
          seller: {
            id: input.sellerId,
          },
          name: input.name,
          description: input.description,
          priceCents: input.priceCents,
          status: input.status,
          imageUrl: input.imageUrl,
        }),
      );

      await inventories.save(
        inventories.create({
          product,
          quantityAvailable: input.quantityAvailable,
        }),
      );

      return product;
    });
  }
}
