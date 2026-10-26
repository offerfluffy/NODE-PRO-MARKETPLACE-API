import { Injectable } from '@nestjs/common';
import { OrderStatus } from '../database/entities/order.entity.js';
import { OrdersRepository } from '../database/repositories/orders.repository.js';

export type OrderItemResponse = {
  product_id: string;
  quantity: number;
  price_cents: number;
};

export type OrderResponse = {
  id: string;
  customer_id: string;
  status: OrderStatus;
  total_cents: number;
  items: OrderItemResponse[];
};

@Injectable()
export class OrdersService {
  constructor(private readonly ordersRepository: OrdersRepository) {}

  async findById(id: string): Promise<OrderResponse | null> {
    const order = await this.ordersRepository.findByIdWithItems(id);

    if (!order) {
      return null;
    }

    return {
      id: order.id,
      customer_id: order.customer.id,
      status: order.status,
      total_cents: order.totalAmountCents,
      items: order.items.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        price_cents: item.unitPriceCents,
      })),
    };
  }
}