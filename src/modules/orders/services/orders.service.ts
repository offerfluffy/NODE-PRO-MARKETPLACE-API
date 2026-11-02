import { Injectable } from '@nestjs/common';
import { OrdersRepository } from '../../database/repositories/orders.repository.js';
import {
  orderResponseSchema,
  type OrderResponseDto,
} from '../dto/order-response.dto.js';
import { CheckoutService } from './checkout/index.js';
import { OrderStatus } from '../../database/entities/order.entity.js';
import { OrderEventsService } from '../realtime/order-events.service.js';
import { OrderPlacedPublisher } from '../../messaging/rabbitmq/order-placed.publisher.js';
import { createOrderPlacedEvent, orderPlacedEventSchema } from '../events/order-placed.event.js';

export type CreateOrderCommand = {
  customerId: string;
  idempotencyKey: string;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly checkoutService: CheckoutService,
    private readonly orderEventsService: OrderEventsService,
    private readonly orderPlacedPublisher: OrderPlacedPublisher,
  ) {}

  async findById(id: string): Promise<OrderResponseDto | null> {
    const order = await this.ordersRepository.findByIdWithItems(id);

    if (!order) {
      return null;
    }

    return orderResponseSchema.parse({
      id: order.id,
      customer_id: order.customer.id,
      status: order.status,
      total_cents: order.totalAmountCents,
      items: order.items.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        price_cents: item.unitPriceCents,
      })),
    });
  }

  async create(input: CreateOrderCommand): Promise<OrderResponseDto> {
    const checkout = await this.checkoutService.checkout(input);

    const event = orderPlacedEventSchema.parse(createOrderPlacedEvent(checkout));;
    await this.orderPlacedPublisher.publish(event);

    return orderResponseSchema.parse({
      id: checkout.orderId,
      customer_id: checkout.customerId,
      status: checkout.status,
      total_cents: checkout.totalAmountCents,
      items: checkout.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
        price_cents: item.unitPriceCents,
      })),
    });
  }

  async updateStatus(id: string, status: OrderStatus): Promise<boolean> {
    const updated = await this.ordersRepository.updateStatus(id, status);

    if (updated === false) {
      return false;
    }

    await this.orderEventsService.publish(id, status);
    return true;
  }

  async isOwnedByCustomer(id: string, customerId: string): Promise<boolean> {
    return this.ordersRepository.isOwnedByCustomer(id, customerId);
  }
}
