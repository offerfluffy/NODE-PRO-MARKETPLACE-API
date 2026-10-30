import { Order } from '../../src/modules/database/entities/order.entity.js';
import { OrderItem } from '../../src/modules/database/entities/orderItem.entity.js';
import { Product } from '../../src/modules/database/entities/product.entity.js';
import { UserRole } from '../../src/modules/database/entities/user.entity.js';
import { OrdersRepository } from '../../src/modules/database/repositories/orders.repository.js';
import { UsersRepository } from '../../src/modules/database/repositories/users.repository.js';
import { anOrder, anOrderItem, aProduct, aUser } from './testkit/builders.js';
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from './testkit/postgres.js';

describe('OrdersRepository integration', () => {
  let database: TestDatabase | undefined;
  let users: UsersRepository;
  let orders: OrdersRepository;

  function getDatabase(): TestDatabase {
    if (!database) {
      throw new Error('Test database was not initialized');
    }

    return database;
  }

  beforeAll(async () => {
    database = await startTestDatabase();
    users = new UsersRepository(database.dataSource);
    orders = new OrdersRepository(database.dataSource);
  });

  beforeEach(async () => {
    await getDatabase().dataSource.query(
      'TRUNCATE users RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    if (database) {
      await stopTestDatabase(database);
    }
  });

  it('persists an order for an existing customer', async () => {
    const customer = await users.create(aUser());
    const input = anOrder(customer.id);

    const created = await orders.create(input);

    const persisted = await getDatabase()
      .dataSource.getRepository(Order)
      .findOneByOrFail({ id: created.id });

    expect(persisted).toMatchObject({
      status: input.status,
      totalAmountCents: input.totalAmountCents,
      idempotencyKey: input.idempotencyKey,
    });
  });

  it('loads the customer, items and products through joins', async () => {
    const customer = await users.create(aUser());
    const seller = await users.create(
      aUser({
        role: UserRole.SELLER,
      }),
    );

    const productRepository = getDatabase().dataSource.getRepository(Product);
    const product = await productRepository.save(
      productRepository.create(aProduct(seller.id)),
    );

    const order = await orders.create(anOrder(customer.id));

    const itemRepository = getDatabase().dataSource.getRepository(OrderItem);
    await itemRepository.save(
      itemRepository.create(anOrderItem(order.id, product.id)),
    );

    const found = await orders.findByIdWithItems(order.id);

    expect(found).toMatchObject({
      id: order.id,
      customer: {
        id: customer.id,
      },
      items: [
        {
          quantity: 2,
          unitPriceCents: 2_649,
          product: {
            id: product.id,
            name: product.name,
          },
        },
      ],
    });
  });

  it('rejects a repeated idempotency key for the same customer', async () => {
    const customer = await users.create(aUser());
    const idempotencyKey = 'same-checkout-request';

    await orders.create(
      anOrder(customer.id, {
        idempotencyKey,
      }),
    );

    await expect(
      orders.create(
        anOrder(customer.id, {
          idempotencyKey,
        }),
      ),
    ).rejects.toHaveProperty('driverError.code', '23505');
  });
});
