import type { DataSource, Repository } from 'typeorm';
import { Product, type ProductStatus } from '../entities/product.entity.js';

export type ProductCardRecord = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  quantityAvailable: number;
  unitsSold: number;
  status: ProductStatus;
  imageUrl: string | null;
  sellerId: string;
  sellerName: string;
};

export class ProductCardRepository {
  private readonly products: Repository<Product>;

  constructor(dataSource: DataSource) {
    this.products = dataSource.getRepository(Product);
  }

  async findById(id: string): Promise<ProductCardRecord | null> {
    const row = await this.products
      .createQueryBuilder('product')
      .innerJoin('product.seller', 'seller')
      .innerJoin('product.inventory', 'inventory')
      .leftJoin('product.orderItems', 'orderItem')
      .select('product.id', 'id')
      .addSelect('product.name', 'name')
      .addSelect('product.description', 'description')
      .addSelect('product.priceCents', 'priceCents')
      .addSelect('inventory.quantityAvailable', 'quantityAvailable')
      .addSelect('COALESCE(SUM(orderItem.quantity), 0)::int', 'unitsSold')
      .addSelect('product.status', 'status')
      .addSelect('product.imageUrl', 'imageUrl')
      .addSelect('seller.id', 'sellerId')
      .addSelect('seller.fullName', 'sellerName')
      .where('product.id = :id', { id })
      .groupBy('product.id')
      .addGroupBy('seller.id')
      .addGroupBy('inventory.id')
      .getRawOne<ProductCardRecord>();

    return row ?? null;
  }
}
