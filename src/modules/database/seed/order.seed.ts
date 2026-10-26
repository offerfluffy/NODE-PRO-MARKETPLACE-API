import { EntityManager } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity.js';
import { User } from '../entities/user.entity.js';

type OrderSeed = Pick<
  Order,
  'status' | 'totalAmountCents' | 'idempotencyKey'
> & {
  key: string;
  customerEmail: string;
};

export const ORDER_SEEDS: OrderSeed[] = [
  {
    key: 'order-001',
    customerEmail: 'customer.one@example.com',
    status: OrderStatus.PENDING,
    totalAmountCents: 24_700,
    idempotencyKey: 'seed-order-001',
  },
  {
    key: 'order-002',
    customerEmail: 'customer.two@example.com',
    status: OrderStatus.PAID,
    totalAmountCents: 12_400,
    idempotencyKey: 'seed-order-002',
  },
  {
    key: 'order-003',
    customerEmail: 'customer.three@example.com',
    status: OrderStatus.COMPLETED,
    totalAmountCents: 20_900,
    idempotencyKey: 'seed-order-003',
  },
  {
    key: 'order-004',
    customerEmail: 'customer.four@example.com',
    status: OrderStatus.PENDING,
    totalAmountCents: 20_000,
    idempotencyKey: 'seed-order-004',
  },
  {
    key: 'order-005',
    customerEmail: 'customer.five@example.com',
    status: OrderStatus.CANCELLED,
    totalAmountCents: 18_900,
    idempotencyKey: 'seed-order-005',
  },
  {
    key: 'order-006',
    customerEmail: 'customer.one@example.com',
    status: OrderStatus.COMPLETED,
    totalAmountCents: 18_700,
    idempotencyKey: 'seed-order-006',
  },
];

export async function seedOrders(
  manager: EntityManager,
  usersByEmail: Map<string, User>,
): Promise<Map<string, Order>> {
  const repository = manager.getRepository(Order);
  const ordersByKey = new Map<string, Order>();

  for (const seed of ORDER_SEEDS) {
    const { key, customerEmail, ...orderData } = seed;
    const customer = usersByEmail.get(customerEmail);

    if (!customer) {
      throw new Error(`Seed customer not found: ${customerEmail}`);
    }

    let order = await repository.findOne({
      where: {
        customer: { id: customer.id },
        idempotencyKey: orderData.idempotencyKey,
      },
    });

    if (!order) {
      order = await repository.save(
        repository.create({ ...orderData, customer }),
      );
    }

    ordersByKey.set(key, order);
  }

  return ordersByKey;
}
