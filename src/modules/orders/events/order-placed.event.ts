import type { CheckoutResult } from '../services/checkout/index.js';

export type OrderPlacedEvent = {
  eventId: string;
  type: 'order.placed';
  occurredAt: string;
  data: {
    orderId: string;
    customerId: string;
    totalAmountCents: number;
    items: Array<{
      productId: string;
      quantity: number;
      unitPriceCents: number;
    }>;
  };
};

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
