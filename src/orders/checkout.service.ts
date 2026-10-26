import { Injectable } from '@nestjs/common';
import { DataSource, In, type EntityManager } from 'typeorm';
import { Product, ProductStatus } from '../database/entities/product.entity.js';

export type CheckoutInput = {
  customerId: string;
  productId: string;
  quantity: number;
  idempotencyKey: string;
};

export type CheckoutItemInput = {
  productId: string;
  quantity: number;
};

type PricedCheckoutItem = CheckoutItemInput & {
  unitPriceCents: number;
};

type PricedCheckout = {
  items: PricedCheckoutItem[];
  totalAmountCents: number;
};

export type CheckoutResult = {
  orderId: string;
  remainingStock: number;
  remainingBalanceCents: number;
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
    productId,
    quantity,
    idempotencyKey,
  }: CheckoutInput): Promise<CheckoutResult> {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('Quantity must be a positive integer');
    }

    return this.dataSource.transaction(async (manager) => {
      const pricedCheckout = await priceCheckoutItems(manager, [
        {
          productId,
          quantity,
        },
      ]);

      const pricedItem = pricedCheckout.items[0];

      if (!pricedItem) {
        throw new Error('Priced checkout item was not returned');
      }

      const { totalAmountCents } = pricedCheckout;

      if (
        !Number.isSafeInteger(totalAmountCents) ||
        totalAmountCents > 2_147_483_647
      ) {
        throw new Error('Order total is outside the supported range');
      }

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
        [productId, quantity],
      );

      const inventory = inventoryRows[0];

      if (!inventory) {
        throw new Error('Insufficient stock');
      }

      const remainingStock = inventory.quantity_available;

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

      const remainingBalanceCents = balance.balance_cents;

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
        [
          pricedItem.quantity,
          pricedItem.unitPriceCents,
          orderId,
          pricedItem.productId,
        ],
      );

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
        remainingStock,
        remainingBalanceCents,
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

  const pricedItems = items.map((item): PricedCheckoutItem => {
    const product = productsById.get(item.productId);

    if (!product) {
      throw new Error(`Product ${item.productId} is unavailable`);
    }

    return {
      ...item,
      unitPriceCents: product.priceCents,
    };
  });

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
