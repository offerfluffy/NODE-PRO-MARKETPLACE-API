import { Injectable } from '@nestjs/common';
import type { OrderPlacedEvent } from '../../events/order-placed.event.js';

@Injectable()
export class CheckoutTransactionHook {
  async afterOutboxEnqueued(_event: OrderPlacedEvent): Promise<void> {}
}
