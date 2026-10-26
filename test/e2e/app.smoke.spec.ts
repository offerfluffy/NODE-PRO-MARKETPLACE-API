import request from 'supertest';
import {
  startTestApplication,
  stopTestApplication,
  type TestApplication,
} from './testkit/app.js';
import { seedDatabase } from '../../src/modules/database/seed/seed-database.js';
import {
  Order,
  OrderStatus,
} from '../../src/modules/database/entities/order.entity.js';
import { Inventory } from '../../src/modules/database/entities/inventory.entity.js';
import { Product } from '../../src/modules/database/entities/product.entity.js';
import { User } from '../../src/modules/database/entities/user.entity.js';

describe('Application E2E', () => {
  let context: TestApplication;

  beforeAll(async () => {
    context = await startTestApplication();
    await seedDatabase(context.dataSource);
  });

  afterAll(async () => {
    if (context) {
      await stopTestApplication(context);
    }
  });

  it('connects the full application to the test database', async () => {
    const response = await request(context.app.getHttpServer())
      .get('/db')
      .expect(200);

    expect(response.body.current_user).toBe(context.container.getUsername());
  });

  it('returns 404 when an order does not exist', async () => {
    const response = await request(context.app.getHttpServer())
      .get('/orders/999999')
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Order 999999 was not found',
    });
  });

  it('returns an order with its items from the real database', async () => {
    const seededOrder = await context.dataSource
      .getRepository(Order)
      .findOneByOrFail({
        idempotencyKey: 'seed-order-001',
      });

    const response = await request(context.app.getHttpServer())
      .get(`/orders/${seededOrder.id}`)
      .expect(200);

    expect(response.body).toEqual({
      id: seededOrder.id,
      customer_id: expect.any(String),
      status: OrderStatus.PENDING,
      total_cents: 24_700,
      items: [
        {
          product_id: expect.any(String),
          quantity: 1,
          price_cents: 12_900,
        },
        {
          product_id: expect.any(String),
          quantity: 2,
          price_cents: 5_900,
        },
      ],
    });
  });

  it('creates a multi-item order, applies checkout once and reads it back', async () => {
    const userRepository = context.dataSource.getRepository(User);
    const productRepository = context.dataSource.getRepository(Product);
    const inventoryRepository = context.dataSource.getRepository(Inventory);

    const [customer, keyboard, mouse] = await Promise.all([
      userRepository.findOneByOrFail({
        email: 'customer.two@example.com',
      }),
      productRepository.findOneByOrFail({
        name: 'Mechanical Keyboard',
      }),
      productRepository.findOneByOrFail({
        name: 'Wireless Mouse',
      }),
    ]);

    const [keyboardInventoryBefore, mouseInventoryBefore] = await Promise.all([
      inventoryRepository.findOneOrFail({
        where: { product: { id: keyboard.id } },
      }),
      inventoryRepository.findOneOrFail({
        where: { product: { id: mouse.id } },
      }),
    ]);

    const totalCents = keyboard.priceCents + mouse.priceCents * 2;
    const requestBody = {
      customer_id: customer.id,
      idempotency_key: 'e2e-create-read-order',
      items: [
        { product_id: mouse.id, quantity: 2 },
        { product_id: keyboard.id, quantity: 1 },
      ],
    };

    const expectedItems = [
      {
        product_id: keyboard.id,
        quantity: 1,
        price_cents: keyboard.priceCents,
      },
      {
        product_id: mouse.id,
        quantity: 2,
        price_cents: mouse.priceCents,
      },
    ].sort((left, right) => {
      const leftId = BigInt(left.product_id);
      const rightId = BigInt(right.product_id);

      if (leftId < rightId) {
        return -1;
      }

      if (leftId > rightId) {
        return 1;
      }

      return 0;
    });

    const createResponse = await request(context.app.getHttpServer())
      .post('/orders')
      .send(requestBody)
      .expect(201);

    expect(createResponse.body).toEqual({
      id: expect.any(String),
      customer_id: customer.id,
      status: OrderStatus.PAID,
      total_cents: totalCents,
      items: expectedItems,
    });

    const readResponse = await request(context.app.getHttpServer())
      .get(`/orders/${createResponse.body.id}`)
      .expect(200);

    expect(readResponse.body).toEqual(createResponse.body);

    const [
      customerAfterCreate,
      keyboardInventoryAfterCreate,
      mouseInventoryAfterCreate,
    ] = await Promise.all([
      userRepository.findOneByOrFail({ id: customer.id }),
      inventoryRepository.findOneOrFail({
        where: { product: { id: keyboard.id } },
      }),
      inventoryRepository.findOneOrFail({
        where: { product: { id: mouse.id } },
      }),
    ]);

    expect(customerAfterCreate.balanceCents).toBe(
      customer.balanceCents - totalCents,
    );
    expect(keyboardInventoryAfterCreate.quantityAvailable).toBe(
      keyboardInventoryBefore.quantityAvailable - 1,
    );
    expect(mouseInventoryAfterCreate.quantityAvailable).toBe(
      mouseInventoryBefore.quantityAvailable - 2,
    );

    const retryResponse = await request(context.app.getHttpServer())
      .post('/orders')
      .send(requestBody)
      .expect(201);

    expect(retryResponse.body).toEqual(createResponse.body);

    const [
      customerAfterRetry,
      keyboardInventoryAfterRetry,
      mouseInventoryAfterRetry,
    ] = await Promise.all([
      userRepository.findOneByOrFail({ id: customer.id }),
      inventoryRepository.findOneOrFail({
        where: { product: { id: keyboard.id } },
      }),
      inventoryRepository.findOneOrFail({
        where: { product: { id: mouse.id } },
      }),
    ]);

    expect(customerAfterRetry.balanceCents).toBe(
      customerAfterCreate.balanceCents,
    );
    expect(keyboardInventoryAfterRetry.quantityAvailable).toBe(
      keyboardInventoryAfterCreate.quantityAvailable,
    );
    expect(mouseInventoryAfterRetry.quantityAvailable).toBe(
      mouseInventoryAfterCreate.quantityAvailable,
    );

    const orderCount = await context.dataSource.getRepository(Order).count({
      where: {
        customer: { id: customer.id },
        idempotencyKey: requestBody.idempotency_key,
      },
    });
    const jobCountRows = await context.dataSource.query<
      Array<{ count: number }>
    >(
      `
        SELECT count(*)::integer AS count
        FROM jobs
        WHERE type = 'order_post_processing'
          AND payload->>'orderId' = $1
      `,
      [createResponse.body.id],
    );

    expect(orderCount).toBe(1);
    expect(jobCountRows[0]?.count).toBe(1);
  });
});
