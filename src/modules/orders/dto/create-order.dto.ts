import { z } from 'zod';
import {
  checkoutItemsSchema,
  postgresBigintIdSchema,
} from '../services/checkout/checkout-item.schema.js';

const createOrderRequestSchema = z
  .strictObject({
    customer_id: z.unknown(),
    idempotency_key: z.unknown(),
    items: z.array(
      z.strictObject({
        product_id: z.unknown(),
        quantity: z.unknown(),
      }),
    ),
  })
  .transform((order) => ({
    customerId: order.customer_id,
    idempotencyKey: order.idempotency_key,
    items: order.items.map((item) => ({
      productId: item.product_id,
      quantity: item.quantity,
    })),
  }));

export const createOrderSchema = createOrderRequestSchema.pipe(
  z.strictObject({
    customerId: postgresBigintIdSchema,
    idempotencyKey: z.string().trim().min(1),
    items: checkoutItemsSchema,
  }),
);

export { postgresBigintIdSchema };

export type CreateOrderDto = z.infer<typeof createOrderSchema>;
