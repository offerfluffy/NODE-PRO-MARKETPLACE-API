import dataSource from '../data-source.js';
import { seedInventories } from './inventory.seed.js';
import { seedOrderItems } from './order-item.seed.js';
import { seedOrders } from './order.seed.js';
import { seedProducts } from './product.seed.js';
import { seedUsers } from './user.seed.js';

async function seed(): Promise<void> {
  await dataSource.initialize();

  try {
    const counts = await dataSource.transaction(async (manager) => {
      const usersByEmail = await seedUsers(manager);
      const productsByKey = await seedProducts(manager, usersByEmail);
      const inventoryCount = await seedInventories(manager, productsByKey);
      const ordersByKey = await seedOrders(manager, usersByEmail);
      const orderItemCount = await seedOrderItems(
        manager,
        ordersByKey,
        productsByKey,
      );

      return {
        users: usersByEmail.size,
        products: productsByKey.size,
        inventories: inventoryCount,
        orders: ordersByKey.size,
        orderItems: orderItemCount,
      };
    });

    console.table(counts);
    console.log('Seed completed successfully');
  } finally {
    await dataSource.destroy();
  }
}

seed().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
