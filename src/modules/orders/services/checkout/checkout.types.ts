import type { OrderStatus } from '../../../database/entities/order.entity.js';
import type { z } from 'zod';
import type { checkoutItemInputSchema } from './checkout-item.schema.js';

export type CheckoutItemInput = z.infer<typeof checkoutItemInputSchema>;

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
  items: PricedCheckoutItem[];
};

export type PricedCheckoutItem = CheckoutItemInput & {
  unitPriceCents: number;
};

export type PricedCheckout = {
  items: PricedCheckoutItem[];
  totalAmountCents: number;
};
