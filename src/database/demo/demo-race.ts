import { checkout } from '../utils/checkout';
import dataSource from '../data-source';
import { Product, ProductStatus } from '../entities/product.entity';
import { User } from '../entities/user.entity';

type AttemptResult =
  { success: true; orderId: string } | { success: false; error: string };

type StockRow = {
  quantity_available: number;
};

type NegativeStockCountRow = {
  count: number;
};

const ATTEMPTS = 50;
const INITIAL_STOCK = 10;
const RACE_KEY_PREFIX = 'race-';

async function prepareRaceFixture(): Promise<{
  customerId: string;
  productId: string;
}> {
  return dataSource.transaction(async (manager) => {
    // 1. Find customer by email.
    const userRepository = manager.getRepository(User);
    const user = await userRepository.findOneBy({
      email: 'customer.two@example.com',
    });

    if (!user) {
      throw new Error('Race customer was not found');
    }

    // 2. Find active product by name.
    const productRepository = manager.getRepository(Product);
    const product = await productRepository.findOneBy({
      name: 'Laptop Stand',
      status: ProductStatus.ACTIVE,
    });

    if (!product) {
      throw new Error('Race product was not found or is not active');
    }

    // 3. Delete jobs belonging to earlier race orders.
    await manager.query(
      `
        DELETE FROM jobs
        WHERE type = 'order_post_processing'
          AND payload->>'orderId' IN (
            SELECT id::text
            FROM orders
            WHERE idempotency_key LIKE $1
          );
      `,
      [`${RACE_KEY_PREFIX}%`],
    );

    // 4. Delete earlier orders whose idempotency key starts with "race-".
    await manager.query(
      `
        DELETE FROM orders
        WHERE idempotency_key LIKE $1;
      `,
      [`${RACE_KEY_PREFIX}%`],
    );

    // 5. Set the product stock to the deterministic race value.
    await manager.query(
      `
        UPDATE inventories
        SET quantity_available = $2,
            updated_at = now()
        WHERE product_id = $1;
      `,
      [product.id, INITIAL_STOCK],
    );

    // 6. Set the customer balance high enough for all 50 attempts.
    await manager.query(
      `
        UPDATE users
        SET balance_cents = $2,
            updated_at = now()
        WHERE id = $1;
      `,
      [user.id, 1_000_000],
    );

    // 7. Return the resolved IDs.
    return {
      customerId: user.id,
      productId: product.id,
    };
  });
}

async function runRaceDemo(): Promise<void> {
  const { customerId, productId } = await prepareRaceFixture();

  const attemptPromises = Array.from(
    { length: ATTEMPTS },
    (_, index): Promise<AttemptResult> =>
      checkout({
        customerId,
        productId,
        quantity: 1,
        idempotencyKey: `${RACE_KEY_PREFIX}${index + 1}`,
      })
        .then((result) => ({
          success: true as const,
          orderId: result.orderId,
        }))
        .catch((error: unknown) => ({
          success: false as const,
          error: error instanceof Error ? error.message : String(error),
        })),
  );

  const results = await Promise.all(attemptPromises);

  const successful = results.filter((result) => result.success);
  const failed = results.filter((result) => !result.success);

  const stockRows = await dataSource.query<StockRow[]>(
    `
      SELECT quantity_available
      FROM inventories
      WHERE product_id = $1
    `,
    [productId],
  );

  const negativeStockRows = await dataSource.query<NegativeStockCountRow[]>(
    `
      SELECT count(*)::integer AS count
      FROM inventories
      WHERE quantity_available < 0
    `,
  );

  const stock = stockRows[0];
  const negativeStock = negativeStockRows[0];

  if (!stock) {
    throw new Error('Race product inventory was not found');
  }

  if (!negativeStock) {
    throw new Error('Negative-stock count was not returned');
  }

  const finalStock = stock.quantity_available;
  const negativeStockCount = negativeStock.count;

  console.log(`Attempts: ${results.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Final stock: ${finalStock}`);
  console.log(`Negative-stock rows: ${negativeStockCount}`);

  if (
    results.length !== ATTEMPTS ||
    successful.length !== INITIAL_STOCK ||
    finalStock !== 0 ||
    negativeStockCount !== 0
  ) {
    throw new Error('Race invariant failed');
  }
}

async function main(): Promise<void> {
  await dataSource.initialize();

  try {
    await runRaceDemo();
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

main().catch((error: unknown) => {
  console.error('Race demo failed:', error);
  process.exitCode = 1;
});
