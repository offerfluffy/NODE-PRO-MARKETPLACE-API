import dataSource from '../data-source.js';
import { OrderStatus } from '../entities/order.entity.js';
import { OrderItem } from '../entities/orderItem.entity.js';

interface SellerRevenueRow {
  sellerId: string;
  sellerName: string;
  orderCount: string;
  revenueCents: string;
}

async function main(): Promise<void> {
  await dataSource.initialize();

  try {
    const rows = await dataSource
      .getRepository(OrderItem)
      .createQueryBuilder('item')
      .innerJoin('item.product', 'product')
      .innerJoin('product.seller', 'seller')
      .innerJoin('item.order', 'purchase')
      .select('seller.id', 'sellerId')
      .addSelect('seller.fullName', 'sellerName')
      .addSelect('COUNT(DISTINCT purchase.id)', 'orderCount')
      .addSelect('SUM(item.quantity * item.unitPriceCents)', 'revenueCents')
      .where('purchase.status IN (:...statuses)', {
        statuses: [OrderStatus.PAID, OrderStatus.COMPLETED],
      })
      .groupBy('seller.id')
      .addGroupBy('seller.fullName')
      .orderBy('SUM(item.quantity * item.unitPriceCents)', 'DESC')
      .getRawMany<SellerRevenueRow>();

    console.table(rows);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error('Report failed:', error);
  process.exitCode = 1;
});
