import type { EntityManager } from 'typeorm';
import {
  CustomerUnavailableError,
  InsufficientFundsError,
  InsufficientStockError,
} from '../../checkout.errors.js';
import type { PricedCheckoutItem } from './checkout.types.js';

type CustomerStateRow = {
  role: string;
};

type InventoryUpdateRow = {
  quantity_available: number;
};

type BalanceUpdateRow = {
  balance_cents: number;
};

type InsertedOrderRow = {
  id: string;
};

type UpdateReturningResult<Row> = [rows: Row[], affected: number];

export async function reserveInventory(
  manager: EntityManager,
  items: PricedCheckoutItem[],
): Promise<void> {
  for (const item of items) {
    const [inventoryRows] = await manager.query<
      UpdateReturningResult<InventoryUpdateRow>
    >(
      `
        UPDATE inventories
        SET quantity_available = quantity_available - $2,
            updated_at = now()
        WHERE product_id = $1
          AND quantity_available >= $2
        RETURNING quantity_available
      `,
      [item.productId, item.quantity],
    );

    if (!inventoryRows[0]) {
      throw new InsufficientStockError(
        `Insufficient stock for product ${item.productId}`,
      );
    }
  }
}

export async function debitCustomer(
  manager: EntityManager,
  customerId: string,
  totalAmountCents: number,
): Promise<void> {
  const [balanceRows] = await manager.query<
    UpdateReturningResult<BalanceUpdateRow>
  >(
    `
      UPDATE users
      SET balance_cents = balance_cents - $2,
          updated_at = now()
      WHERE id = $1
        AND role = 'customer'
        AND balance_cents >= $2
      RETURNING balance_cents
    `,
    [customerId, totalAmountCents],
  );

  if (balanceRows[0]) {
    return;
  }

  const customerRows = await manager.query<CustomerStateRow[]>(
    `
      SELECT role
      FROM users
      WHERE id = $1
    `,
    [customerId],
  );
  const customer = customerRows[0];

  if (!customer || customer.role !== 'customer') {
    throw new CustomerUnavailableError(`Customer ${customerId} was not found`);
  }

  throw new InsufficientFundsError('Customer has insufficient funds');
}

export async function createPaidOrder(
  manager: EntityManager,
  customerId: string,
  idempotencyKey: string,
  totalAmountCents: number,
): Promise<string> {
  const orderRows = await manager.query<InsertedOrderRow[]>(
    `
      INSERT INTO orders (
        status,
        total_amount_cents,
        idempotency_key,
        customer_id
      )
      VALUES ('paid', $1, $2, $3)
      RETURNING id
    `,
    [totalAmountCents, idempotencyKey, customerId],
  );
  const order = orderRows[0];

  if (!order) {
    throw new Error('Order was not created');
  }

  return order.id;
}

export async function createOrderItems(
  manager: EntityManager,
  orderId: string,
  items: PricedCheckoutItem[],
): Promise<void> {
  for (const item of items) {
    await manager.query(
      `
        INSERT INTO order_items (
          quantity,
          unit_price_cents,
          order_id,
          product_id
        )
        VALUES ($1, $2, $3, $4)
      `,
      [item.quantity, item.unitPriceCents, orderId, item.productId],
    );
  }
}

export async function enqueueOrderPostProcessing(
  manager: EntityManager,
  orderId: string,
  customerId: string,
): Promise<void> {
  await manager.query(
    `
      INSERT INTO jobs (
        type,
        payload
      )
      VALUES ($1, $2::jsonb)
    `,
    [
      'order_post_processing',
      JSON.stringify({
        orderId,
        customerId,
      }),
    ],
  );
}
