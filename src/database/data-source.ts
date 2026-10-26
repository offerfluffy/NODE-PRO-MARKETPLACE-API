import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from './entities/user.entity.js';
import { Product } from './entities/product.entity.js';
import { Inventory } from './entities/inventory.entity.js';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/orderItem.entity.js';
import { Job } from './entities/job.entity.js';

const port = Number(requiredEnv('DB_PORT'));

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error('DB_PORT must be a valid port number');
}

const dataSource = new DataSource({
  type: 'postgres',

  host: requiredEnv('DB_HOST'),
  port,
  username: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),
  database: requiredEnv('DB_NAME'),

  entities: [User, Product, Inventory, Order, OrderItem, Job],

  migrations: [`${import.meta.dirname}/migrations/*.js`],

  synchronize: false,
});

export default dataSource;

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
