import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import dataSource from '../src/modules/database/data-source.js';
import { ProductCardRepository } from '../src/modules/database/repositories/product-card.repository.js';
import { ProductCardCacheService } from '../src/modules/products/product-card-cache.service.js';
import { ProductCardService } from '../src/modules/products/product-card.service.js';
import { queryCountLogger } from './query-count.logger.js';

const FIXTURE_COUNT = 50;
const CONCURRENT_READS = 20;
const WARM_READS = 100;

type InsertedIdRow = {
  id: string;
};

type CacheDemoFixtures = {
  productIds: string[];
  sellerId: string;
};

const demoDataSource = new DataSource({
  ...dataSource.options,
  logging: ['query'],
  logger: queryCountLogger,
});

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function createFixtures(): Promise<CacheDemoFixtures> {
  const namespace = randomUUID();
  return demoDataSource.transaction(async (manager) => {
    const sellers = await manager.query<InsertedIdRow[]>(
      `
        INSERT INTO users (
          email,
          password_hash,
          full_name,
          role,
          balance_cents
        )
        VALUES ($1, 'demo-only', 'Cache Demo Seller', 'seller', 0)
        RETURNING id
      `,
      [`cache-demo-${namespace}@example.test`],
    );
    const seller = sellers[0];

    if (!seller) {
      throw new Error('Failed to create the cache-demo seller');
    }

    const products = await manager.query<InsertedIdRow[]>(
      `
        INSERT INTO products (
          seller_id,
          name,
          description,
          price_cents,
          status,
          image_url
        )
        SELECT
          $1,
          $2 || '-' || fixture_number,
          'Temporary cache demo product',
          1000 + fixture_number,
          'active',
          NULL
        FROM generate_series(1, $3::integer) AS fixture_number
        RETURNING id
      `,
      [seller.id, `cache-demo-${namespace}`, FIXTURE_COUNT],
    );
    const productIds = products.map((product) => product.id);

    await manager.query(
      `
        INSERT INTO inventories (product_id, quantity_available)
        SELECT product_id, 100
        FROM unnest($1::bigint[]) AS product_id
      `,
      [productIds],
    );

    return {
      productIds,
      sellerId: seller.id,
    };
  });
}

async function cleanFixtures(
  fixtures: CacheDemoFixtures | undefined,
): Promise<void> {
  if (!fixtures) {
    return;
  }

  await demoDataSource.query(
    'DELETE FROM products WHERE id = ANY($1::bigint[])',
    [fixtures.productIds],
  );
  await demoDataSource.query('DELETE FROM users WHERE id = $1', [
    fixtures.sellerId,
  ]);
}

async function main(): Promise<void> {
  const redis = new Redis(requiredEnv('REDIS_URL'));
  let fixtures: CacheDemoFixtures | undefined;

  await demoDataSource.initialize();

  try {
    const policyConfig = (await redis.config(
      'GET',
      'maxmemory-policy',
    )) as unknown as string[];
    const memoryConfig = (await redis.config(
      'GET',
      'maxmemory',
    )) as unknown as string[];
    const cacheLru = policyConfig[1] === 'allkeys-lru';
    const cacheMaxmemory = Number(memoryConfig[1] ?? 0) > 0;

    if (!cacheLru || !cacheMaxmemory) {
      throw new Error(
        `Invalid cache policy: policy=${policyConfig[1] ?? 'none'} maxmemory=${memoryConfig[1] ?? 'none'}`,
      );
    }

    fixtures = await createFixtures();

    if (fixtures.productIds.length !== FIXTURE_COUNT) {
      throw new Error(
        `Expected ${FIXTURE_COUNT} fixtures, created ${fixtures.productIds.length}`,
      );
    }

    const repository = new ProductCardRepository(demoDataSource);
    const cache = new ProductCardCacheService(redis);
    const service = new ProductCardService(repository, cache);
    const warmedProducts = await Promise.all(
      fixtures.productIds.map((id) => service.findById(id)),
    );
    const warmed = warmedProducts.filter((product) => product !== null).length;
    const ttlValues = await Promise.all(
      fixtures.productIds.map((id) => redis.ttl(`product-card:v1:${id}`)),
    );
    const ttlDistinct = new Set(ttlValues).size;

    if (warmed !== FIXTURE_COUNT || ttlDistinct < 5) {
      throw new Error(
        `Expected ${FIXTURE_COUNT} warmed products and at least five TTL values, received warmed=${warmed} ttl-distinct=${ttlDistinct}`,
      );
    }

    const targetId = fixtures.productIds[0];

    if (!targetId) {
      throw new Error('The cache demo did not create a target product');
    }

    await cache.invalidate(targetId);
    queryCountLogger.reset();

    const concurrentProducts = await Promise.all(
      Array.from({ length: CONCURRENT_READS }, () =>
        service.findById(targetId),
      ),
    );
    const dbCalls = queryCountLogger.count;

    if (
      concurrentProducts.some((product) => product === null) ||
      dbCalls !== 1
    ) {
      throw new Error(
        `Expected ${CONCURRENT_READS} products from one SQL query, received db-calls=${dbCalls}`,
      );
    }

    queryCountLogger.reset();

    const warmProducts = await Promise.all(
      Array.from({ length: WARM_READS }, () => service.findById(targetId)),
    );
    const dbCallsWarm = queryCountLogger.count;

    if (warmProducts.some((product) => product === null) || dbCallsWarm !== 0) {
      throw new Error(
        `Expected ${WARM_READS} warm products from zero SQL queries, received db-calls-warm=${dbCallsWarm}`,
      );
    }

    console.log(`cache-lru=${cacheLru ? 1 : 0}`);
    console.log(`cache-maxmemory=${cacheMaxmemory ? 1 : 0}`);
    console.log(`warmed=${warmed}`);
    console.log(`ttl-distinct=${ttlDistinct}`);
    console.log(`concurrent=${CONCURRENT_READS}`);
    console.log(`db-calls=${dbCalls}`);
    console.log(`db-calls-warm=${dbCallsWarm}`);
  } finally {
    queryCountLogger.echo = false;

    if (fixtures) {
      const keys = fixtures.productIds.flatMap((id) => [
        `product-card:v1:${id}`,
        `lock:product-card:v1:${id}`,
      ]);

      await redis.del(...keys).catch(() => undefined);
    }

    await cleanFixtures(fixtures).catch(() => undefined);
    await demoDataSource.destroy().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
