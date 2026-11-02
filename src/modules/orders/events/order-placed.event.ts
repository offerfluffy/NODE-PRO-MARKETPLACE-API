import z from 'zod';
import type { CheckoutResult } from '../services/checkout/index.js';
import { postgresBigintIdSchema } from '../services/checkout/checkout-item.schema.js';

export const orderPlacedEventSchema = z.strictObject({
  eventId: z.string().trim().min(1),
  type: z.literal('order.placed'),
  occurredAt: z.iso.datetime(),
  data: z.strictObject({
    orderId: postgresBigintIdSchema,
    customerId: postgresBigintIdSchema,
    totalAmountCents: z.number().int().positive(),
    items: z.array(
      z.strictObject({
        productId: postgresBigintIdSchema,
        quantity: z.number().int().positive(),
        unitPriceCents: z.number().int().positive(),
      }),
    ).min(1),
  }),
});

export type OrderPlacedEvent = z.infer<
  typeof orderPlacedEventSchema
>;

export function createOrderPlacedEvent(
  checkout: CheckoutResult,
): OrderPlacedEvent {
  return {
    eventId: `order.placed:${checkout.orderId}`,
    type: 'order.placed',
    occurredAt: checkout.createdAt.toISOString(),
    data: {
      orderId: checkout.orderId,
      customerId: checkout.customerId,
      totalAmountCents: checkout.totalAmountCents,
      items: checkout.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
      })),
    },
  };
}
