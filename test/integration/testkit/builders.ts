import type { DeepPartial } from 'typeorm';
import { OrderStatus } from '../../../src/database/entities/order.entity';
import type { OrderItem } from '../../../src/database/entities/orderItem.entity';
import {
  ProductStatus,
  type Product,
} from '../../../src/database/entities/product.entity';
import { UserRole } from '../../../src/database/entities/user.entity';
import type { CreateOrderInput } from '../../../src/database/repositories/orders.repository';
import type { CreateUserInput } from '../../../src/database/repositories/users.repository';

let userSequence = 0;

export function aUser(
  overrides: Partial<CreateUserInput> = {},
): CreateUserInput {
  userSequence += 1;

  return {
    email: `user-${userSequence}@example.com`,
    passwordHash: 'test-password-hash',
    fullName: `Test User ${userSequence}`,
    role: UserRole.CUSTOMER,
    balanceCents: 10_000,
    ...overrides,
  };
}

let productSequence = 0;
let orderSequence = 0;

export function aProduct(
  sellerId: string,
  overrides: DeepPartial<Product> = {},
): DeepPartial<Product> {
  productSequence += 1;

  return {
    seller: { id: sellerId },
    name: `Product ${productSequence}`,
    description: `Description ${productSequence}`,
    priceCents: 2_649,
    status: ProductStatus.ACTIVE,
    imageUrl: null,
    ...overrides,
  };
}

export function anOrder(
  customerId: string,
  overrides: Partial<CreateOrderInput> = {},
): CreateOrderInput {
  orderSequence += 1;

  return {
    customerId,
    status: OrderStatus.PENDING,
    totalAmountCents: 5_298,
    idempotencyKey: `order-${orderSequence}`,
    ...overrides,
  };
}

export function anOrderItem(
  orderId: string,
  productId: string,
  overrides: DeepPartial<OrderItem> = {},
): DeepPartial<OrderItem> {
  return {
    order: { id: orderId },
    product: { id: productId },
    quantity: 2,
    unitPriceCents: 2_649,
    ...overrides,
  };
}
