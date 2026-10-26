import { Inventory } from './inventory.entity.js';
import { Job } from './job.entity.js';
import { Order } from './order.entity.js';
import { OrderItem } from './orderItem.entity.js';
import { Product } from './product.entity.js';
import { User } from './user.entity.js';

export const databaseEntities = [
  User,
  Product,
  Inventory,
  Order,
  OrderItem,
  Job,
];
