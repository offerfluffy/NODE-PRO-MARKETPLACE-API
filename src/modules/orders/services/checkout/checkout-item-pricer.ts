import { In, type EntityManager } from 'typeorm';
import {
  Product,
  ProductStatus,
} from '../../../database/entities/product.entity.js';
import {
  CheckoutTotalOutOfRangeError,
  InvalidCheckoutError,
  ProductUnavailableError,
} from '../../checkout.errors.js';
import { checkoutItemsSchema } from './checkout-item.schema.js';
import type {
  CheckoutItemInput,
  PricedCheckout,
  PricedCheckoutItem,
} from './checkout.types.js';

export async function priceCheckoutItems(
  manager: EntityManager,
  items: CheckoutItemInput[],
): Promise<PricedCheckout> {
  const validationResult = checkoutItemsSchema.safeParse(items);

  if (!validationResult.success) {
    const firstIssue = validationResult.error.issues[0];

    throw new InvalidCheckoutError(
      firstIssue?.message ?? 'Checkout items are invalid',
    );
  }

  const validatedItems = validationResult.data;
  const productIds = validatedItems.map((item) => item.productId);
  const products = await manager.getRepository(Product).find({
    select: {
      id: true,
      priceCents: true,
    },
    where: {
      id: In(productIds),
      status: ProductStatus.ACTIVE,
    },
  });

  if (products.length !== validatedItems.length) {
    throw new ProductUnavailableError(
      'One or more products were not found or unavailable',
    );
  }

  const productsById = new Map(
    products.map((product) => [product.id, product]),
  );

  const pricedItems = validatedItems
    .map((item): PricedCheckoutItem => {
      const product = productsById.get(item.productId);

      if (!product) {
        throw new ProductUnavailableError(
          `Product ${item.productId} is unavailable`,
        );
      }

      return {
        ...item,
        unitPriceCents: product.priceCents,
      };
    })
    .sort(compareCheckoutItemsByProductId);

  const totalAmountCents = pricedItems.reduce(
    (total, item) =>
      total + BigInt(item.unitPriceCents) * BigInt(item.quantity),
    0n,
  );

  if (totalAmountCents <= 0n || totalAmountCents > 2_147_483_647n) {
    throw new CheckoutTotalOutOfRangeError(
      'Order total is outside the supported range',
    );
  }

  return {
    items: pricedItems,
    totalAmountCents: Number(totalAmountCents),
  };
}

export function compareCheckoutItemsByProductId(
  left: CheckoutItemInput,
  right: CheckoutItemInput,
): number {
  const leftId = BigInt(left.productId);
  const rightId = BigInt(right.productId);

  if (leftId < rightId) {
    return -1;
  }

  if (leftId > rightId) {
    return 1;
  }

  return 0;
}
