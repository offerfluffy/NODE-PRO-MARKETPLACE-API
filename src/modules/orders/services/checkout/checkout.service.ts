import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderStatus } from '../../../database/entities/order.entity.js';
import {
  assertMatchingCheckoutItems,
  findExistingCheckout,
  isIdempotencyUniqueViolation,
} from './checkout-idempotency.js';
import { priceCheckoutItems } from './checkout-item-pricer.js';
import {
  createOrderItems,
  createPaidOrder,
  debitCustomer,
  reserveInventory,
} from './checkout-persistence.js';
import type { CheckoutInput, CheckoutResult } from './checkout.types.js';
import { createOrderPlacedEvent } from '../../events/order-placed.event.js';
import { enqueueOrderPlacedEvent } from '../../events/enqueue-order-placed-event.js';
import { CheckoutTransactionHook } from './checkout-transaction.hook.js';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionHook: CheckoutTransactionHook,
  ) {}

  async checkout({
    customerId,
    items,
    idempotencyKey,
  }: CheckoutInput): Promise<CheckoutResult> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const existingCheckout = await findExistingCheckout(
          manager,
          customerId,
          idempotencyKey,
        );

        if (existingCheckout) {
          assertMatchingCheckoutItems(existingCheckout, items);
          return existingCheckout;
        }

        const pricedCheckout = await priceCheckoutItems(manager, items);

        await reserveInventory(manager, pricedCheckout.items);
        await debitCustomer(
          manager,
          customerId,
          pricedCheckout.totalAmountCents,
        );

        const { id: orderId, createdAt } = await createPaidOrder(
          manager,
          customerId,
          idempotencyKey,
          pricedCheckout.totalAmountCents,
        );

        await createOrderItems(manager, orderId, pricedCheckout.items);

        const checkout: CheckoutResult = {
          orderId,
          customerId,
          status: OrderStatus.PAID,
          totalAmountCents: pricedCheckout.totalAmountCents,
          createdAt,
          items: pricedCheckout.items,
        };

        const event = createOrderPlacedEvent(checkout);
        await enqueueOrderPlacedEvent(manager, event);
        await this.transactionHook.afterOutboxEnqueued(event);

        return checkout;
      });
    } catch (error: unknown) {
      if (!isIdempotencyUniqueViolation(error)) {
        throw error;
      }

      const existingCheckout = await findExistingCheckout(
        this.dataSource,
        customerId,
        idempotencyKey,
      );

      if (!existingCheckout) {
        throw error;
      }

      assertMatchingCheckoutItems(existingCheckout, items);
      return existingCheckout;
    }
  }
}
