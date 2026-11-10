import assert from 'node:assert/strict';
import { connect } from 'amqplib';
import request from 'supertest';
import dataSource from '../src/modules/database/data-source.js';
import { relayOutboxBatch } from '../src/modules/messaging/outbox/outbox-relay.js';
import { publishOrderPlaced } from '../src/modules/messaging/rabbitmq/order-placed.publisher.js';
import { ORDER_PLACED_TOPOLOGY } from '../src/modules/messaging/rabbitmq/order-placed.topology.js';
import { orderResponseSchema } from '../src/modules/orders/dto/order-response.dto.js';
import { ORDER_PLACED_EFFECT_CONSUMER } from '../src/modules/orders/events/apply-order-placed.effect.js';
import { startOutboxDemoApp } from './outbox-demo-app.js';
import {
  prepareOutboxDemoBroker,
  startOutboxDemoConsumer,
} from './outbox-demo-consumer.js';
import { prepareOutboxDemoFixture } from './outbox-demo-fixture.js';

const DEMO_IDEMPOTENCY_KEY = 'hw-22-demo-outbox';
const REQUESTS = 2;
const RELAY_BATCH_SIZE = 100;

type DemoCounts = {
  orders: number;
  outbox: number;
  published: number;
  effect: number;
  processed: number;
};

async function run(): Promise<void> {
  await dataSource.initialize();

  try {
    const fixture = await prepareOutboxDemoFixture(
      dataSource,
      DEMO_IDEMPOTENCY_KEY,
    );
    const connection = await connect(requiredEnv('BROKER_URL'));

    try {
      const consumerChannel = await connection.createChannel();

      try {
        await prepareOutboxDemoBroker(consumerChannel);

        const publishChannel = await connection.createConfirmChannel();

        try {
          const app = await startOutboxDemoApp();

          try {
            const orderRequest = {
              customer_id: fixture.customerId,
              items: [
                {
                  product_id: fixture.productId,
                  quantity: 1,
                },
              ],
            };
            const firstResponse = await request(app.getHttpServer())
              .post('/orders')
              .set('Idempotency-Key', fixture.idempotencyKey)
              .send(orderRequest)
              .expect(201);
            const secondResponse = await request(app.getHttpServer())
              .post('/orders')
              .set('Idempotency-Key', fixture.idempotencyKey)
              .send(orderRequest)
              .expect(201);
            const firstOrder = orderResponseSchema.parse(firstResponse.body);
            const secondOrder = orderResponseSchema.parse(secondResponse.body);

            assert.equal(
              secondOrder.id,
              firstOrder.id,
              'The repeated request must return the original order',
            );
            assert.equal(firstOrder.customer_id, fixture.customerId);
            assert.equal(firstOrder.total_cents, fixture.unitPriceCents);

            const consumer = await startOutboxDemoConsumer(
              consumerChannel,
              dataSource,
              1,
            );
            void consumer.completed.catch(() => undefined);

            try {
              const relayed = await relayOutboxBatch(
                dataSource,
                (event) => publishOrderPlaced(publishChannel, event),
                RELAY_BATCH_SIZE,
              );

              assert.equal(relayed, 1, 'The relay must publish one outbox row');
              await consumer.completed;

              const eventId = `order.placed:${firstOrder.id}`;
              const counts = await readDemoCounts(
                fixture.customerId,
                fixture.idempotencyKey,
                firstOrder.id,
                eventId,
              );
              const queue = await consumerChannel.checkQueue(
                ORDER_PLACED_TOPOLOGY.queue,
              );

              assert.deepEqual(counts, {
                orders: 1,
                outbox: 1,
                published: 1,
                effect: 1,
                processed: 1,
              });
              assert.equal(consumer.stats.deliveries, 1);
              assert.equal(consumer.stats.applied, 1);
              assert.equal(consumer.stats.skipped, 0);
              assert.equal(queue.messageCount, 0);

              printResults(counts, consumer.stats.deliveries);
            } finally {
              consumer.stopWaiting(new Error('Outbox demo stopped'));
              await consumerChannel.cancel(consumer.consumerTag);
            }
          } finally {
            await app.close();
          }
        } finally {
          await publishChannel.close();
        }
      } finally {
        await consumerChannel.close();
      }
    } finally {
      await connection.close();
    }
  } finally {
    await dataSource.destroy();
  }
}

async function readDemoCounts(
  customerId: string,
  idempotencyKey: string,
  orderId: string,
  eventId: string,
): Promise<DemoCounts> {
  const rows = await dataSource.query<DemoCounts[]>(
    `
      SELECT
        (
          SELECT COUNT(*)::integer
          FROM orders
          WHERE customer_id = $1
            AND idempotency_key = $2
        ) AS orders,
        (
          SELECT COUNT(*)::integer
          FROM outbox
          WHERE aggregate_type = 'Order'
            AND aggregate_id = $3
        ) AS outbox,
        (
          SELECT COUNT(*)::integer
          FROM outbox
          WHERE aggregate_type = 'Order'
            AND aggregate_id = $3
            AND published_at IS NOT NULL
        ) AS published,
        (
          SELECT COUNT(*)::integer
          FROM jobs
          WHERE event_id = $4
        ) AS effect,
        (
          SELECT COUNT(*)::integer
          FROM processed_messages
          WHERE message_id = $4
            AND consumer = $5
        ) AS processed
    `,
    [
      customerId,
      idempotencyKey,
      orderId,
      eventId,
      ORDER_PLACED_EFFECT_CONSUMER,
    ],
  );
  const counts = rows[0];

  if (!counts) {
    throw new Error('Outbox demo count query returned no rows');
  }

  return counts;
}

function printResults(counts: DemoCounts, deliveries: number): void {
  console.log(`requests=${REQUESTS}`);
  console.log(`orders=${counts.orders}`);
  console.log(`outbox=${counts.outbox}`);
  console.log(`published=${counts.published}`);
  console.log(`deliveries=${deliveries}`);
  console.log(`effect=${counts.effect}`);
  console.log(`processed=${counts.processed}`);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
