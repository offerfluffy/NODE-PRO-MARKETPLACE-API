import dataSource from '../data-source';
import { Product, ProductStatus } from '../entities/product.entity';

export type CheckoutInput = {
  customerId: string;
  productId: string;
  quantity: number;
  idempotencyKey: string;
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

export async function checkout({
  customerId,
  productId,
  quantity,
  idempotencyKey,
}: CheckoutInput): Promise<CheckoutResult> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive integer');
  }

  return dataSource.transaction(async (manager) => {
    const productRepository = manager.getRepository(Product);

    const product = await productRepository.findOne({
      select: {
        id: true,
        priceCents: true,
      },
      where: {
        id: productId,
        status: ProductStatus.ACTIVE,
      },
    });

    if (!product) {
      throw new Error('Product not found or unavailable');
    }

    const totalAmountCents = product.priceCents * quantity;

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
      [quantity, product.priceCents, orderId, product.id],
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
