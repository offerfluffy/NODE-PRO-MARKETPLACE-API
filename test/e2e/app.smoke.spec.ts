import request from 'supertest';
import {
  startTestApplication,
  stopTestApplication,
  type TestApplication,
} from './testkit/app.js';
import { seedDatabase } from '../../src/database/seed/seed-database.js';
import {
  Order,
  OrderStatus,
} from '../../src/database/entities/order.entity.js';
import { User } from '../../src/database/entities/user.entity.js';

describe('Application E2E', () => {
  let context: TestApplication;

  beforeAll(async () => {
    context = await startTestApplication();
    await seedDatabase(context.dataSource);
  });

  afterAll(async () => {
    await stopTestApplication(context);
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

  it('creates an order and reads it back', async () => {
    const customer = await context.dataSource
      .getRepository(User)
      .findOneByOrFail({
        email: 'customer.two@example.com',
      });

    const createResponse = await request(context.app.getHttpServer())
      .post('/orders')
      .send({
        customer_id: customer.id,
        total_cents: 34_500,
        idempotency_key: 'e2e-create-read-order',
      })
      .expect(201);

    expect(createResponse.body).toEqual({
      id: expect.any(String),
      customer_id: customer.id,
      status: OrderStatus.PENDING,
      total_cents: 34_500,
      items: [],
    });

    const readResponse = await request(context.app.getHttpServer())
      .get(`/orders/${createResponse.body.id}`)
      .expect(200);

    expect(readResponse.body).toEqual(createResponse.body);
  });
});
