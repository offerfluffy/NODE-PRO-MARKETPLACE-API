import { DataSource } from 'typeorm';
import dataSource from '../data-source.js';
import { Order } from '../entities/order.entity.js';
import { OrderItem } from '../entities/orderItem.entity.js';
import { queryCountLogger } from './query-count.logger.js';

const demoDataSource = new DataSource({
  ...dataSource.options,
  logging: ['query'],
  logger: queryCountLogger,
});

async function main(): Promise<void> {
  await demoDataSource.initialize();

  try {
    const orderRepository = demoDataSource.getRepository(Order);
    const orderItemRepository = demoDataSource.getRepository(OrderItem);

    queryCountLogger.reset();
    queryCountLogger.echo = true;

    const orders = await orderRepository.find({
      order: { id: 'ASC' },
    });

    for (const order of orders) {
      const items = await orderItemRepository.find({
        where: {
          order: { id: order.id },
        },
        relations: {
          product: true,
        },
      });

      order.items = items;
    }

    queryCountLogger.echo = false;

    console.log('');
    console.log(`Orders loaded: ${orders.length}`);
    console.log(`Naïve query count: ${queryCountLogger.count}`);

    const naiveQueryCount = queryCountLogger.count;

    queryCountLogger.reset();
    queryCountLogger.echo = true;

    const ordersWithRelations = await orderRepository.find({
      relations: {
        items: {
          product: true,
        },
      },
      order: {
        id: 'ASC',
      },
    });

    const fixedQueryCount = queryCountLogger.count;
    queryCountLogger.echo = false;

    const loadedItemCount = ordersWithRelations.reduce(
      (total, order) => total + order.items.length,
      0,
    );

    console.log('');
    console.log(`Orders loaded with relations: ${ordersWithRelations.length}`);
    console.log(`Order items loaded: ${loadedItemCount}`);
    console.log(`Fixed query count: ${fixedQueryCount}`);
    console.log(`Result: ${naiveQueryCount} → ${fixedQueryCount}`);
  } finally {
    queryCountLogger.echo = false;
    await demoDataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error('N+1 demo failed:', error);
  process.exitCode = 1;
});
