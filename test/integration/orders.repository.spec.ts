import { Order } from '../../src/database/entities/order.entity';
import { OrderItem } from '../../src/database/entities/orderItem.entity';
import { Product } from '../../src/database/entities/product.entity';
import { UserRole } from '../../src/database/entities/user.entity';
import { OrdersRepository } from '../../src/database/repositories/orders.repository';
import { UsersRepository } from '../../src/database/repositories/users.repository';
import { anOrder, anOrderItem, aProduct, aUser } from './testkit/builders';
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from './testkit/postgres';

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
