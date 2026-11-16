import { Inventory } from '../../src/modules/database/entities/inventory.entity.js';
import {
  Product,
  ProductStatus,
} from '../../src/modules/database/entities/product.entity.js';
import { UserRole } from '../../src/modules/database/entities/user.entity.js';
import { ProductsRepository } from '../../src/modules/database/repositories/products.repository.js';
import { UsersRepository } from '../../src/modules/database/repositories/users.repository.js';
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from './testkit/postgres.js';
import { aUser } from './testkit/builders.js';

describe('ProductsRepository', () => {
  let context: TestDatabase;

  beforeAll(async () => {
    context = await startTestDatabase();
  });

  afterAll(async () => {
    if (context) {
      await stopTestDatabase(context);
    }
  });

  it('creates a product and inventory in one transaction', async () => {
    const users = new UsersRepository(context.dataSource);
    const products = new ProductsRepository(context.dataSource);
    const seller = await users.create(
      aUser({
        role: UserRole.SELLER,
      }),
    );

    const created = await products.createWithInventory({
      sellerId: seller.id,
      name: 'Integration Keyboard',
      description: 'Created by repository integration test',
      priceCents: 12_900,
      quantityAvailable: 7,
      status: ProductStatus.ACTIVE,
      imageUrl: null,
    });

    const persisted = await context.dataSource
      .getRepository(Product)
      .findOneOrFail({
        where: { id: created.id },
        relations: {
          seller: true,
          inventory: true,
        },
      });

    expect(persisted.seller.id).toBe(seller.id);
    expect(persisted.inventory.quantityAvailable).toBe(7);
  });

  it('rolls back the product when inventory creation fails', async () => {
    const users = new UsersRepository(context.dataSource);
    const products = new ProductsRepository(context.dataSource);
    const seller = await users.create(
      aUser({
        role: UserRole.SELLER,
      }),
    );
    const name = 'Rolled Back Product';

    await expect(
      products.createWithInventory({
        sellerId: seller.id,
        name,
        description: 'Inventory violates its database check',
        priceCents: 1_000,
        quantityAvailable: -1,
        status: ProductStatus.DRAFT,
        imageUrl: null,
      }),
    ).rejects.toBeDefined();

    await expect(
      context.dataSource.getRepository(Product).findOneBy({ name }),
    ).resolves.toBeNull();
    await expect(
      context.dataSource.getRepository(Inventory).count(),
    ).resolves.toBe(1);
  });
});
