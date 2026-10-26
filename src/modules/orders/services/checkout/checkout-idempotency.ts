import { QueryFailedError, type EntityManager } from 'typeorm';
import type { OrderStatus } from '../../../database/entities/order.entity.js';
import { IdempotencyConflictError } from '../../checkout.errors.js';
import { compareCheckoutItemsByProductId } from './checkout-item-pricer.js';
import type { CheckoutItemInput, CheckoutResult } from './checkout.types.js';

type ExistingCheckoutRow = {
  order_id: string;
  customer_id: string;
  status: OrderStatus;
  total_amount_cents: number;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
};

type CheckoutQueryExecutor = Pick<EntityManager, 'query'>;

type PostgresDriverError = {
  code?: string;
  constraint?: string;
};

export async function findExistingCheckout(
  executor: CheckoutQueryExecutor,
  customerId: string,
  idempotencyKey: string,
): Promise<CheckoutResult | null> {
  const rows = await executor.query<ExistingCheckoutRow[]>(
    `
      SELECT
        orders.id AS order_id,
        orders.customer_id,
        orders.status,
        orders.total_amount_cents,
        order_items.product_id,
        order_items.quantity,
        order_items.unit_price_cents
      FROM orders
      INNER JOIN order_items
        ON order_items.order_id = orders.id
      WHERE orders.customer_id = $1
        AND orders.idempotency_key = $2
      ORDER BY order_items.product_id ASC
    `,
    [customerId, idempotencyKey],
  );

  const firstRow = rows[0];

  if (!firstRow) {
    return null;
  }

  return {
    orderId: firstRow.order_id,
    customerId: firstRow.customer_id,
    status: firstRow.status,
    totalAmountCents: firstRow.total_amount_cents,
    items: rows.map((row) => ({
      productId: row.product_id,
      quantity: row.quantity,
      unitPriceCents: row.unit_price_cents,
    })),
  };
}

export function assertMatchingCheckoutItems(
  existing: CheckoutResult,
  requestedItems: CheckoutItemInput[],
): void {
  const normalizedRequestedItems = [...requestedItems].sort(
    compareCheckoutItemsByProductId,
  );
  const hasSameItems =
    existing.items.length === normalizedRequestedItems.length &&
    existing.items.every((existingItem, index) => {
      const requestedItem = normalizedRequestedItems[index];

      return (
        requestedItem !== undefined &&
        existingItem.productId === requestedItem.productId &&
        existingItem.quantity === requestedItem.quantity
      );
    });

  if (!hasSameItems) {
    throw new IdempotencyConflictError(
      'Idempotency key was already used with different items',
    );
  }
}

export function isIdempotencyUniqueViolation(
  error: unknown,
): error is QueryFailedError {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }

  const driverError = error.driverError as PostgresDriverError;

  return (
    driverError.code === '23505' &&
    driverError.constraint === 'UQ_orders_customer_id_idempotency_key'
  );
}
