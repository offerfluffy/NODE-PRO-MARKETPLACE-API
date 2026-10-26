import { Injectable } from '@nestjs/common';
import { DataSource, In, type EntityManager } from 'typeorm';
import { Product, ProductStatus } from '../database/entities/product.entity.js';
import { OrderStatus } from '../database/entities/order.entity.js';

type ExistingCheckoutRow = {
  order_id: string;
  customer_id: string;
  status: OrderStatus;
  total_amount_cents: number;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
};

export type CheckoutItemInput = {
  productId: string;
  quantity: number;
};

export type CheckoutInput = {
  customerId: string;
  items: CheckoutItemInput[];
  idempotencyKey: string;
};

export type CheckoutResult = {
  orderId: string;
  customerId: string;
  status: OrderStatus;
  totalAmountCents: number;
  items: Array<{
    productId: string;
    quantity: number;
    unitPriceCents: number;
  }>;
};

type PricedCheckoutItem = CheckoutItemInput & {
  unitPriceCents: number;
};

type PricedCheckout = {
  items: PricedCheckoutItem[];
  totalAmountCents: number;
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

@Injectable()
export class CheckoutService {
  constructor(private readonly dataSource: DataSource) {}

  async checkout({
    customerId,
    items,
    idempotencyKey,
  }: CheckoutInput): Promise<CheckoutResult> {
    return this.dataSource.transaction(async (manager) => {
      const existingCheckout = await findExistingCheckout(
        manager,
        customerId,
        idempotencyKey,
      );

      if (existingCheckout) {
        if (!hasSameItems(existingCheckout, items)) {
          throw new Error(
            'Idempotency key was already used with different items',
          );
        }

        return existingCheckout;
      }

      const pricedCheckout = await priceCheckoutItems(manager, items);
      const { totalAmountCents } = pricedCheckout;

      for (const item of pricedCheckout.items) {
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
          throw new Error(`Insufficient stock for product ${item.productId}`);
        }
      }

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

      const balance = balanceRows[0];

      if (!balance) {
        throw new Error('Customer not found or insufficient funds');
      }

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

      const orderId = order.id;

      for (const item of pricedCheckout.items) {
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

      return {
        orderId,
        customerId,
        status: OrderStatus.PAID,
        totalAmountCents,
        items: pricedCheckout.items,
      };
    });
  }
}

async function priceCheckoutItems(
  manager: EntityManager,
  items: CheckoutItemInput[],
): Promise<PricedCheckout> {
  if (items.length === 0) {
    throw new Error('Order must contain at least one item');
  }

  const productIds = new Set<string>();

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error('Quantity must be a positive integer');
    }

    if (productIds.has(item.productId)) {
      throw new Error(`Duplicate product: ${item.productId}`);
    }

    productIds.add(item.productId);
  }

  const products = await manager.getRepository(Product).find({
    select: {
      id: true,
      priceCents: true,
    },
    where: {
      id: In([...productIds]),
      status: ProductStatus.ACTIVE,
    },
  });

  if (products.length !== items.length) {
    throw new Error('One or more products were not found or unavailable');
  }

  const productsById = new Map(
    products.map((product) => [product.id, product]),
  );

  const pricedItems = items
    .map((item): PricedCheckoutItem => {
      const product = productsById.get(item.productId);

      if (!product) {
        throw new Error(`Product ${item.productId} is unavailable`);
      }

      return {
        ...item,
        unitPriceCents: product.priceCents,
      };
    })
    .sort(compareByProductId);

  const totalAmountCents = pricedItems.reduce(
    (total, item) =>
      total + BigInt(item.unitPriceCents) * BigInt(item.quantity),
    0n,
  );

  if (totalAmountCents <= 0n || totalAmountCents > 2_147_483_647n) {
    throw new Error('Order total is outside the supported range');
  }

  return {
    items: pricedItems,
    totalAmountCents: Number(totalAmountCents),
  };
}

function compareByProductId(
  left: CheckoutItemInput,
  right: CheckoutItemInput,
): number {
  const leftId = BigInt(left.productId);
  const rightId = BigInt(right.productId);

  if (leftId < rightId) {
    return -1;
  }

  if (leftId > rightId) {
    return 1;
  }

  return 0;
}

async function findExistingCheckout(
  manager: EntityManager,
  customerId: string,
  idempotencyKey: string,
): Promise<CheckoutResult | null> {
  const rows = await manager.query<ExistingCheckoutRow[]>(
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

function hasSameItems(
  existing: CheckoutResult,
  requestedItems: CheckoutItemInput[],
): boolean {
  const normalizedRequestedItems = [...requestedItems].sort(compareByProductId);

  return (
    existing.items.length === normalizedRequestedItems.length &&
    existing.items.every((existingItem, index) => {
      const requestedItem = normalizedRequestedItems[index];

      return (
        requestedItem !== undefined &&
        existingItem.productId === requestedItem.productId &&
        existingItem.quantity === requestedItem.quantity
      );
    })
  );
}
