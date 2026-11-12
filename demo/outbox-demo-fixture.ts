import type { DataSource } from 'typeorm';
import { seedDatabase } from '../src/modules/database/seed/seed-database.js';

const DEMO_CUSTOMER_EMAIL = 'customer.three@example.com';
const DEMO_PRODUCT_NAME = 'USB-C Hub';
const DEMO_BALANCE_CENTS = 1_000_000;
const DEMO_STOCK = 18;

export type OutboxDemoFixture = {
  customerId: string;
  productId: string;
  unitPriceCents: number;
  idempotencyKey: string;
};

type DemoFixtureRow = {
  customer_id: string;
  product_id: string;
  unit_price_cents: number;
  inventory_id: string;
};

type ExistingOrderRow = {
  id: string;
};

export async function prepareOutboxDemoFixture(
  dataSource: DataSource,
  idempotencyKey: string,
): Promise<OutboxDemoFixture> {
  const normalizedIdempotencyKey = idempotencyKey.trim();

  if (!normalizedIdempotencyKey) {
    throw new Error('Demo idempotency key must not be empty');
  }

  await seedDatabase(dataSource);

  return dataSource.transaction(async (manager) => {
    const fixtureRows = await manager.query<DemoFixtureRow[]>(
      `
        SELECT
          users.id AS customer_id,
          products.id AS product_id,
          products.price_cents AS unit_price_cents,
          inventories.id AS inventory_id
        FROM users
        CROSS JOIN products
        INNER JOIN inventories
          ON inventories.product_id = products.id
        WHERE LOWER(users.email) = LOWER($1)
          AND users.role = 'customer'
          AND products.name = $2
      `,
      [DEMO_CUSTOMER_EMAIL, DEMO_PRODUCT_NAME],
    );

    if (fixtureRows.length !== 1) {
      throw new Error(
        `Expected one demo customer/product fixture, found ${fixtureRows.length}`,
      );
    }

    const fixture = fixtureRows[0];

    if (!fixture) {
      throw new Error('Demo fixture was not found');
    }

    const existingOrders = await manager.query<ExistingOrderRow[]>(
      `
        SELECT id
        FROM orders
        WHERE customer_id = $1
          AND idempotency_key = $2
      `,
      [fixture.customer_id, normalizedIdempotencyKey],
    );
    const existingOrder = existingOrders[0];

    if (existingOrder) {
      const eventId = `order.placed:${existingOrder.id}`;

      await manager.query(
        `DELETE FROM processed_messages WHERE message_id = $1`,
        [eventId],
      );
      await manager.query(`DELETE FROM jobs WHERE event_id = $1`, [eventId]);
      await manager.query(
        `
          DELETE FROM outbox
          WHERE aggregate_type = 'Order'
            AND aggregate_id = $1
        `,
        [existingOrder.id],
      );
      await manager.query(`DELETE FROM orders WHERE id = $1`, [
        existingOrder.id,
      ]);
    }

    await manager.query(
      `
        UPDATE users
        SET balance_cents = $2,
            updated_at = now()
        WHERE id = $1
      `,
      [fixture.customer_id, DEMO_BALANCE_CENTS],
    );
    await manager.query(
      `
        UPDATE inventories
        SET quantity_available = $2,
            updated_at = now()
        WHERE id = $1
      `,
      [fixture.inventory_id, DEMO_STOCK],
    );

    return {
      customerId: fixture.customer_id,
      productId: fixture.product_id,
      unitPriceCents: fixture.unit_price_cents,
      idempotencyKey: normalizedIdempotencyKey,
    };
  });
}
