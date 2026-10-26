import { Injectable } from '@nestjs/common';
import { OrderStatus } from '../database/entities/order.entity.js';
import { OrdersRepository } from '../database/repositories/orders.repository.js';
import {
  orderResponseSchema,
  type OrderResponseDto,
} from './dto/order-response.dto.js';

export type CreateOrderCommand = {
  customerId: string;
  totalAmountCents: number;
  idempotencyKey: string;
};

@Injectable()
export class OrdersService {
  constructor(private readonly ordersRepository: OrdersRepository) {}

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
    const order = await this.ordersRepository.create({
      customerId: input.customerId,
      status: OrderStatus.PENDING,
      totalAmountCents: input.totalAmountCents,
      idempotencyKey: input.idempotencyKey,
    });

    return orderResponseSchema.parse({
      id: order.id,
      customer_id: input.customerId,
      status: order.status,
      total_cents: order.totalAmountCents,
      items: [],
    });
  }
}
