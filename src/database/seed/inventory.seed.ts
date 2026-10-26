import { EntityManager } from 'typeorm';
import { Inventory } from '../entities/inventory.entity.js';
import { Product } from '../entities/product.entity.js';

type InventorySeed = Pick<Inventory, 'quantityAvailable'> & {
  productKey: string;
};

export const INVENTORY_SEEDS: InventorySeed[] = [
  { productKey: 'keyboard', quantityAvailable: 20 },
  { productKey: 'mouse', quantityAvailable: 35 },
  { productKey: 'usb-hub', quantityAvailable: 18 },
  { productKey: 'laptop-stand', quantityAvailable: 24 },
  { productKey: 'web-camera', quantityAvailable: 8 },
  { productKey: 'headphones', quantityAvailable: 15 },
  { productKey: 'microphone', quantityAvailable: 12 },
  { productKey: 'audio-interface', quantityAvailable: 7 },
  { productKey: 'microphone-arm', quantityAvailable: 21 },
  { productKey: 'pop-filter', quantityAvailable: 30 },
];

export async function seedInventories(
  manager: EntityManager,
  productsByKey: Map<string, Product>,
): Promise<number> {
  const repository = manager.getRepository(Inventory);
  let count = 0;

  for (const seed of INVENTORY_SEEDS) {
    const product = productsByKey.get(seed.productKey);

    if (!product) {
      throw new Error(`Seed product not found: ${seed.productKey}`);
    }

    const existing = await repository.findOne({
      where: { product: { id: product.id } },
    });

    if (!existing) {
      await repository.save(
        repository.create({
          product,
          quantityAvailable: seed.quantityAvailable,
        }),
      );
    }

    count += 1;
  }

  return count;
}
