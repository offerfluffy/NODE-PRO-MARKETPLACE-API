import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

const CRASH_WORKER_ARGUMENT = '--crash-worker';
const CRASH_WORKER_MARKER = 'CRASH_RELAY_PUBLISHED=1';
const CRASH_WORKER_TIMEOUT_MS = 10_000;
const DEMO_IDEMPOTENCY_KEY = 'hw-22-demo-crash-relay';
const EXPECTED_PUBLISHES = 2;
const EXPECTED_DELIVERIES = 2;

type CrashRelayCounts = {
  orders: number;
  outbox: number;
  marked_published: number;
  attempts: number;
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
          let orderId: string;

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
              })
              .expect(201);

            orderId = orderResponseSchema.parse(response.body).id;
          } finally {
            await app.close();
          }

          const consumer = await startOutboxDemoConsumer(
            consumerChannel,
            dataSource,
            EXPECTED_DELIVERIES,
          );
          void consumer.completed.catch(() => undefined);

          try {
            const firstPublish = await runAndKillCrashRelayWorker();
            const retriedRows = await relayOutboxBatch(
              dataSource,
              (event) => publishOrderPlaced(publishChannel, event),
              1,
            );
            const published = firstPublish + retriedRows;

            assert.equal(
              retriedRows,
              1,
              'The restarted relay must find the unpublished outbox row',
            );
            assert.equal(published, EXPECTED_PUBLISHES);

            await consumer.completed;

            const eventId = `order.placed:${orderId}`;
            const counts = await readCrashRelayCounts(
              fixture.customerId,
              fixture.idempotencyKey,
              orderId,
              eventId,
            );
            const queue = await consumerChannel.checkQueue(
              ORDER_PLACED_TOPOLOGY.queue,
            );

            assert.deepEqual(counts, {
              orders: 1,
              outbox: 1,
              marked_published: 1,
              attempts: 1,
              effect: 1,
              processed: 1,
            });
            assert.equal(consumer.stats.deliveries, EXPECTED_DELIVERIES);
            assert.equal(consumer.stats.applied, 1);
            assert.equal(consumer.stats.skipped, 1);
            assert.equal(queue.messageCount, 0);

            printResults(published, consumer.stats, counts);
          } finally {
            consumer.stopWaiting(new Error('Crash-relay demo stopped'));
            await consumerChannel.cancel(consumer.consumerTag);
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

async function runCrashRelayWorker(): Promise<void> {
  await dataSource.initialize();

  const connection = await connect(requiredEnv('BROKER_URL'));
  const channel = await connection.createConfirmChannel();

  await relayOutboxBatch(
    dataSource,
    async (event) => {
      await publishOrderPlaced(channel, event);
      process.stdout.write(`${CRASH_WORKER_MARKER}\n`);

      await new Promise<never>(() => {});
    },
    1,
  );
}

function runAndKillCrashRelayWorker(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), CRASH_WORKER_ARGUMENT],
      {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let markerReceived = false;
    let timedOut = false;
    let stderr = '';
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, CRASH_WORKER_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.on('data', (chunk: string) => {
      if (!markerReceived && chunk.includes(CRASH_WORKER_MARKER)) {
        markerReceived = true;
        child.kill('SIGKILL');
      }
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timeout);

      if (timedOut) {
        reject(new Error('Timed out waiting for the relay publish marker'));
        return;
      }

      if (!markerReceived || signal !== 'SIGKILL') {
        reject(
          new Error(
            `Crash relay exited unexpectedly (code=${String(code)}, signal=${String(signal)}): ${stderr.trim()}`,
          ),
        );
        return;
      }

      resolve(1);
    });
  });
}

async function readCrashRelayCounts(
  customerId: string,
  idempotencyKey: string,
  orderId: string,
  eventId: string,
): Promise<CrashRelayCounts> {
  const rows = await dataSource.query<CrashRelayCounts[]>(
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
        ) AS marked_published,
        (
          SELECT COALESCE(SUM(attempts), 0)::integer
          FROM outbox
          WHERE aggregate_type = 'Order'
            AND aggregate_id = $3
        ) AS attempts,
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
    throw new Error('Crash-relay count query returned no rows');
  }

  return counts;
}

function printResults(
  published: number,
  stats: { deliveries: number; applied: number },
  counts: CrashRelayCounts,
): void {
  console.log(`published=${published}`);
  console.log(`deliveries=${stats.deliveries}`);
  console.log(`applied=${stats.applied}`);
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

if (process.argv[2] === CRASH_WORKER_ARGUMENT) {
  runCrashRelayWorker().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
