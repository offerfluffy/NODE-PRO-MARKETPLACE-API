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

export const checkoutItemInputSchema = z.strictObject({
  productId: postgresBigintIdSchema,
  quantity: z.number().int().positive().max(MAX_POSTGRES_INTEGER),
});

export const checkoutItemsSchema = z
  .array(checkoutItemInputSchema)
  .min(1)
  .superRefine((items, context) => {
    const productIds = new Set<string>();

    items.forEach((item, index) => {
      if (productIds.has(item.productId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'productId'],
          message: `Duplicate product: ${item.productId}`,
        });
      }

      productIds.add(item.productId);
    });
  });
