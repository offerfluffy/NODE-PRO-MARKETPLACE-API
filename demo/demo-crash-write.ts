import assert from 'node:assert/strict';
import { connect } from 'amqplib';
import request from 'supertest';
import dataSource from '../src/modules/database/data-source.js';
import { ORDER_PLACED_TOPOLOGY } from '../src/modules/messaging/rabbitmq/order-placed.topology.js';
import type { OrderPlacedEvent } from '../src/modules/orders/events/order-placed.event.js';
import { startOutboxDemoApp } from './outbox-demo-app.js';
import { prepareOutboxDemoBroker } from './outbox-demo-consumer.js';
import { prepareOutboxDemoFixture } from './outbox-demo-fixture.js';

const DEMO_IDEMPOTENCY_KEY = 'hw-22-demo-crash-write';
const DELIVERIES = 0;

type CrashWriteCounts = {
  orders: number;
  outbox: number;
  published: number;
  effect: number;
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
      const channel = await connection.createChannel();

      try {
        await prepareOutboxDemoBroker(channel);

        let attemptedEvent: OrderPlacedEvent | undefined;
        const app = await startOutboxDemoApp({
          afterOutboxEnqueued: async (event) => {
            attemptedEvent = event;
            throw new Error('Intentional crash after outbox insert');
          },
        });

        try {
          const response = await request(app.getHttpServer())
            .post('/orders')
            .set('Idempotency-Key', fixture.idempotencyKey)
            .send({
              customer_id: fixture.customerId,
              items: [
                {
                  product_id: fixture.productId,
                  quantity: 1,
                },
              ],
            });
          const writeFailed = response.status === 500 ? 1 : 0;

          assert.equal(
            writeFailed,
            1,
            `Expected checkout to fail with 500, received ${response.status}`,
          );
          assert.ok(
            attemptedEvent,
            'The failpoint must run after the outbox event is inserted',
          );

          const counts = await readCrashWriteCounts(
            fixture.customerId,
            fixture.idempotencyKey,
            attemptedEvent,
          );
          const queue = await channel.checkQueue(ORDER_PLACED_TOPOLOGY.queue);

          assert.deepEqual(counts, {
            orders: 0,
            outbox: 0,
            published: 0,
            effect: 0,
          });
          assert.equal(queue.messageCount, DELIVERIES);

          printResults(writeFailed, counts);
        } finally {
          await app.close();
        }
      } finally {
        await channel.close();
      }
    } finally {
      await connection.close();
    }
  } finally {
    await dataSource.destroy();
  }
}

async function readCrashWriteCounts(
  customerId: string,
  idempotencyKey: string,
  event: OrderPlacedEvent,
): Promise<CrashWriteCounts> {
  const rows = await dataSource.query<CrashWriteCounts[]>(
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
        ) AS effect
    `,
    [customerId, idempotencyKey, event.data.orderId, event.eventId],
  );
  const counts = rows[0];

  if (!counts) {
    throw new Error('Crash-write count query returned no rows');
  }

  return counts;
}

function printResults(writeFailed: number, counts: CrashWriteCounts): void {
  console.log(`write-failed=${writeFailed}`);
  console.log(`orders=${counts.orders}`);
  console.log(`outbox=${counts.outbox}`);
  console.log(`published=${counts.published}`);
  console.log(`deliveries=${DELIVERIES}`);
  console.log(`effect=${counts.effect}`);
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
