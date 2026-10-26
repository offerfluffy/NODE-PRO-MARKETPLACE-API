import { z } from 'zod';

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

export const postgresBigintIdSchema = z.string().refine(
  (value) => {
    if (!/^[1-9]\d*$/.test(value)) {
      return false;
    }

    return BigInt(value) <= MAX_POSTGRES_BIGINT;
  },
  {
    message: 'Must be a positive PostgreSQL bigint',
  },
);

const createOrderItemSchema = z.strictObject({
  product_id: postgresBigintIdSchema,
  quantity: z.number().int().positive().max(MAX_POSTGRES_INTEGER),
});

export const createOrderSchema = z
  .strictObject({
    customer_id: postgresBigintIdSchema,
    idempotency_key: z.string().trim().min(1),
    items: z.array(createOrderItemSchema).min(1),
  })
  .superRefine((order, context) => {
    const productIds = new Set<string>();

    order.items.forEach((item, index) => {
      if (productIds.has(item.product_id)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'product_id'],
          message: 'Duplicate product',
        });
      }

      productIds.add(item.product_id);
    });
  });

export type CreateOrderDto = z.infer<typeof createOrderSchema>;
