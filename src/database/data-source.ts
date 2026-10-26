import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { databaseEntities } from './entities/index.js';
import { databaseMigrations } from './migrations/index.js';

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

  entities: databaseEntities,
  migrations: databaseMigrations,

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
