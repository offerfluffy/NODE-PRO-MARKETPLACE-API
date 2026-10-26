import { EntityManager } from 'typeorm';
import { Product, ProductStatus } from '../entities/product.entity.js';
import { User } from '../entities/user.entity.js';

type ProductSeed = Pick<
  Product,
  'name' | 'description' | 'priceCents' | 'status' | 'imageUrl'
> & {
  key: string;
  sellerEmail: string;
};

export const PRODUCT_SEEDS: ProductSeed[] = [
  {
    key: 'keyboard',
    sellerEmail: 'seller.one@example.com',
    name: 'Mechanical Keyboard',
    description: 'Compact mechanical keyboard',
    priceCents: 12_900,
    status: ProductStatus.ACTIVE,
    imageUrl: null,
  },
  {
    key: 'mouse',
    sellerEmail: 'seller.one@example.com',
    name: 'Wireless Mouse',
    description: 'Ergonomic wireless mouse',
    priceCents: 5_900,
    status: ProductStatus.ACTIVE,
    imageUrl: null,
  },
  {
    key: 'usb-hub',
    sellerEmail: 'seller.one@example.com',
    name: 'USB-C Hub',
    description: 'Seven-port USB-C hub',
    priceCents: 7_500,
    status: ProductStatus.ACTIVE,
    imageUrl: null,
  },
  {
    key: 'laptop-stand',
    sellerEmail: 'seller.one@example.com',
    name: 'Laptop Stand',
    description: 'Adjustable aluminum laptop stand',
    priceCents: 4_900,
    status: ProductStatus.ACTIVE,
    imageUrl: null,
  },
  {
    key: 'web-camera',
    sellerEmail: 'seller.one@example.com',
    name: 'Web Camera',
    description: 'Full HD web camera',
    priceCents: 8_900,
    status: ProductStatus.DRAFT,
    imageUrl: null,
  },
  {
    key: 'headphones',
    sellerEmail: 'seller.two@example.com',
    name: 'Studio Headphones',
    description: 'Closed-back studio headphones',
    priceCents: 15_900,
    status: ProductStatus.ACTIVE,
    imageUrl: null,
  },
  {
    key: 'microphone',
    sellerEmail: 'seller.two@example.com',
    name: 'USB Microphone',
    description: 'USB condenser microphone',
    priceCents: 13_500,
    status: ProductStatus.ACTIVE,
    imageUrl: null,
  },
  {
    key: 'audio-interface',
    sellerEmail: 'seller.two@example.com',
    name: 'Audio Interface',
    description: 'Two-channel audio interface',
    priceCents: 18_900,
    status: ProductStatus.ACTIVE,
    imageUrl: null,
  },
  {
    key: 'microphone-arm',
    sellerEmail: 'seller.two@example.com',
    name: 'Microphone Arm',
    description: 'Adjustable microphone boom arm',
    priceCents: 6_500,
    status: ProductStatus.ACTIVE,
    imageUrl: null,
  },
  {
    key: 'pop-filter',
    sellerEmail: 'seller.two@example.com',
    name: 'Pop Filter',
    description: 'Dual-layer microphone pop filter',
    priceCents: 2_500,
    status: ProductStatus.ARCHIVED,
    imageUrl: null,
  },
];

export async function seedProducts(
  manager: EntityManager,
  usersByEmail: Map<string, User>,
): Promise<Map<string, Product>> {
  const repository = manager.getRepository(Product);
  const productsByKey = new Map<string, Product>();

  for (const seed of PRODUCT_SEEDS) {
    const { key, sellerEmail, ...productData } = seed;
    const seller = usersByEmail.get(sellerEmail);

    if (!seller) {
      throw new Error(`Seed seller not found: ${sellerEmail}`);
    }

    let product = await repository.findOne({
      where: { name: productData.name, seller: { id: seller.id } },
    });

    if (!product) {
      product = await repository.save(
        repository.create({ ...productData, seller }),
      );
    }

    productsByKey.set(key, product);
  }

  return productsByKey;
}
