import type { DataSource } from 'typeorm';
import { seedInventories } from './inventory.seed.js';
import { seedOrderItems } from './order-item.seed.js';
import { seedOrders } from './order.seed.js';
import { seedProducts } from './product.seed.js';
import { seedUsers } from './user.seed.js';

export type SeedCounts = {
  users: number;
  products: number;
  inventories: number;
  orders: number;
  orderItems: number;
};

export function seedDatabase(dataSource: DataSource): Promise<SeedCounts> {
  return dataSource.transaction(async (manager) => {
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
}
