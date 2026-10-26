import type { OrderStatus } from '../../../database/entities/order.entity.js';

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
  items: PricedCheckoutItem[];
};

export type PricedCheckoutItem = CheckoutItemInput & {
  unitPriceCents: number;
};

export type PricedCheckout = {
  items: PricedCheckoutItem[];
  totalAmountCents: number;
};
