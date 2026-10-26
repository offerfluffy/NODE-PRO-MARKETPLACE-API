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
  enqueueOrderPostProcessing,
  reserveInventory,
} from './checkout-persistence.js';
import type { CheckoutInput, CheckoutResult } from './checkout.types.js';

@Injectable()
export class CheckoutService {
  constructor(private readonly dataSource: DataSource) {}

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

        const orderId = await createPaidOrder(
          manager,
          customerId,
          idempotencyKey,
          pricedCheckout.totalAmountCents,
        );

        await createOrderItems(manager, orderId, pricedCheckout.items);
        await enqueueOrderPostProcessing(manager, orderId, customerId);

        return {
          orderId,
          customerId,
          status: OrderStatus.PAID,
          totalAmountCents: pricedCheckout.totalAmountCents,
          items: pricedCheckout.items,
        };
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
