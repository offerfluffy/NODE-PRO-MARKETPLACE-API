import { DataSource, Repository } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity.js';

export type CreateOrderInput = {
  customerId: string;
  status: OrderStatus;
  totalAmountCents: number;
  idempotencyKey: string;
};

export class OrdersRepository {
  private readonly orders: Repository<Order>;

  constructor(dataSource: DataSource) {
    this.orders = dataSource.getRepository(Order);
  }

  async create(input: CreateOrderInput): Promise<Order> {
    const order = this.orders.create({
      customer: {
        id: input.customerId,
      },
      status: input.status,
      totalAmountCents: input.totalAmountCents,
      idempotencyKey: input.idempotencyKey,
    });

    return this.orders.save(order);
  }

  async updateStatus(id: string, status: OrderStatus): Promise<boolean> {
    const result = await this.orders.update({ id }, { status });

    return result.affected === 1;
  }

  async findByIdWithItems(id: string): Promise<Order | null> {
    return this.orders
      .createQueryBuilder('purchase')
      .innerJoinAndSelect('purchase.customer', 'customer')
      .leftJoinAndSelect('purchase.items', 'item')
      .leftJoinAndSelect('item.product', 'product')
      .where('purchase.id = :id', { id })
      .orderBy('item.id', 'ASC')
      .getOne();
  }
}
