import { EntityManager } from 'typeorm';
import { Order } from '../entities/order.entity.js';
import { OrderItem } from '../entities/orderItem.entity.js';
import { Product } from '../entities/product.entity.js';

type OrderItemSeed = Pick<OrderItem, 'quantity' | 'unitPriceCents'> & {
  orderKey: string;
  productKey: string;
};

export const ORDER_ITEM_SEEDS: OrderItemSeed[] = [
  {
    orderKey: 'order-001',
    productKey: 'keyboard',
    quantity: 1,
    unitPriceCents: 12_900,
  },
  {
    orderKey: 'order-001',
    productKey: 'mouse',
    quantity: 2,
    unitPriceCents: 5_900,
  },
  {
    orderKey: 'order-002',
    productKey: 'usb-hub',
    quantity: 1,
    unitPriceCents: 7_500,
  },
  {
    orderKey: 'order-002',
    productKey: 'laptop-stand',
    quantity: 1,
    unitPriceCents: 4_900,
  },
  {
    orderKey: 'order-003',
    productKey: 'headphones',
    quantity: 1,
    unitPriceCents: 15_900,
  },
  {
    orderKey: 'order-003',
    productKey: 'pop-filter',
    quantity: 2,
    unitPriceCents: 2_500,
  },
  {
    orderKey: 'order-004',
    productKey: 'microphone',
    quantity: 1,
    unitPriceCents: 13_500,
  },
  {
    orderKey: 'order-004',
    productKey: 'microphone-arm',
    quantity: 1,
    unitPriceCents: 6_500,
  },
  {
    orderKey: 'order-005',
    productKey: 'audio-interface',
    quantity: 1,
    unitPriceCents: 18_900,
  },
  {
    orderKey: 'order-006',
    productKey: 'web-camera',
    quantity: 1,
    unitPriceCents: 8_900,
  },
  {
    orderKey: 'order-006',
    productKey: 'laptop-stand',
    quantity: 2,
    unitPriceCents: 4_900,
  },
];

export async function seedOrderItems(
  manager: EntityManager,
  ordersByKey: Map<string, Order>,
  productsByKey: Map<string, Product>,
): Promise<number> {
  const repository = manager.getRepository(OrderItem);
  let count = 0;

  for (const seed of ORDER_ITEM_SEEDS) {
    const order = ordersByKey.get(seed.orderKey);
    const product = productsByKey.get(seed.productKey);

    if (!order) {
      throw new Error(`Seed order not found: ${seed.orderKey}`);
    }

    if (!product) {
      throw new Error(`Seed product not found: ${seed.productKey}`);
    }

    const existing = await repository.findOne({
      where: {
        order: { id: order.id },
        product: { id: product.id },
      },
    });

    if (!existing) {
      await repository.save(
        repository.create({
          order,
          product,
          quantity: seed.quantity,
          unitPriceCents: seed.unitPriceCents,
        }),
      );
    }

    count += 1;
  }

  return count;
}
