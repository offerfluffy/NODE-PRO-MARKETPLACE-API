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

export const createOrderSchema = z.strictObject({
  customer_id: postgresBigintIdSchema,
  total_cents: z
    .number()
    .int()
    .positive()
    .max(MAX_POSTGRES_INTEGER),
  idempotency_key: z.string().trim().min(1),
});

export type CreateOrderDto = z.infer<typeof createOrderSchema>;