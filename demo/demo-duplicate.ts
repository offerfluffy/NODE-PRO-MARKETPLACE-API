import {
  connect,
  type Channel,
  type ConsumeMessage,
} from 'amqplib';
import dataSource from '../src/modules/database/data-source.js';
import { ORDER_PLACED_PREFETCH } from '../src/modules/messaging/rabbitmq/order-placed.consumer.js';
import {
  assertOrderPlacedTopology,
  ORDER_PLACED_TOPOLOGY,
} from '../src/modules/messaging/rabbitmq/order-placed.topology.js';
import { applyOrderPlacedEffect } from '../src/modules/orders/events/apply-order-placed.effect.js';
import {
  orderPlacedEventSchema,
  type OrderPlacedEvent,
} from '../src/modules/orders/events/order-placed.event.js';

const DUPLICATE_ORDER_ID = '900201';
const TIMEOUT_MS = 10_000;

type DuplicateStats = {
  deliveries: number;
  effect: number;
  skipped: number;
  redelivered: boolean;
};

type DuplicateConsumer = {
  consumerTag: string;
  stats: DuplicateStats;
  completed: Promise<void>;
  stopWaiting: (error: Error) => void;
};

function createDuplicateEvent(): OrderPlacedEvent {
  return {
    eventId: `order.placed:${DUPLICATE_ORDER_ID}`,
    type: 'order.placed',
    occurredAt: '2026-11-02T12:20:00.000Z',
    data: {
      orderId: DUPLICATE_ORDER_ID,
      customerId: '900001',
      totalAmountCents: 7_500,
      items: [
        {
          productId: '900001',
          quantity: 1,
          unitPriceCents: 7_500,
        },
      ],
    },
  };
}

async function cleanDemoState(
  channel: Channel,
  event: OrderPlacedEvent,
): Promise<void> {
  const workQueue = await channel.checkQueue(
    ORDER_PLACED_TOPOLOGY.queue,
  );

  if (workQueue.consumerCount !== 0) {
    throw new Error(
      `Expected no competing consumers, found ${workQueue.consumerCount}. Stop the API before running demo:duplicate.`,
    );
  }

  await channel.purgeQueue(ORDER_PLACED_TOPOLOGY.queue);
  await channel.purgeQueue(
    ORDER_PLACED_TOPOLOGY.deadLetterQueue,
  );
  await dataSource.query(
    'DELETE FROM jobs WHERE event_id = $1',
    [event.eventId],
  );
}

async function startDuplicateConsumer(
  channel: Channel,
): Promise<DuplicateConsumer> {
  const stats: DuplicateStats = {
    deliveries: 0,
    effect: 0,
    skipped: 0,
    redelivered: false,
  };
  let resolveCompleted!: () => void;
  let rejectCompleted!: (error: unknown) => void;
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const succeed = (): void => {
    if (!settled) {
      settled = true;
      resolveCompleted();
    }
  };
  const fail = (error: unknown): void => {
    if (!settled) {
      settled = true;
      rejectCompleted(error);
    }
  };
  const completed = new Promise<void>((resolve, reject) => {
    resolveCompleted = resolve;
    rejectCompleted = reject;
  }).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });

  await channel.prefetch(ORDER_PLACED_PREFETCH);

  const { consumerTag } = await channel.consume(
    ORDER_PLACED_TOPOLOGY.queue,
    (message) => {
      if (!message) {
        fail(
          new Error('RabbitMQ cancelled the duplicate demo consumer'),
        );
        return;
      }

      void handleDuplicateMessage(
        channel,
        message,
        stats,
        succeed,
      ).catch((error: unknown) => {
        try {
          channel.reject(message, false);
        } catch {
          // Closing the channel requeues unacknowledged work.
        }

        fail(error);
      });
    },
    { noAck: false },
  );

  timeout = setTimeout(() => {
    fail(new Error('Timed out waiting for duplicate delivery'));
  }, TIMEOUT_MS);

  return {
    consumerTag,
    stats,
    completed,
    stopWaiting: fail,
  };
}

async function handleDuplicateMessage(
  channel: Channel,
  message: ConsumeMessage,
  stats: DuplicateStats,
  succeed: () => void,
): Promise<void> {
  stats.deliveries += 1;

  const body: unknown = JSON.parse(
    message.content.toString('utf8'),
  );
  const event = orderPlacedEventSchema.parse(body);
  const result = await applyOrderPlacedEffect(
    dataSource,
    event,
  );

  if (result === 'applied') {
    stats.effect += 1;
  } else {
    stats.skipped += 1;
  }

  if (stats.deliveries === 1) {
    channel.nack(message, false, true);
    return;
  }

  if (stats.deliveries === 2) {
    stats.redelivered = message.fields.redelivered;
    channel.ack(message);
    succeed();
    return;
  }

  throw new Error(
    `Expected exactly two deliveries, received ${stats.deliveries}`,
  );
}

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function main(): Promise<void> {
  const event = createDuplicateEvent();

  await dataSource.initialize();

  try {
    const connection = await connect(requiredEnv('BROKER_URL'));

    try {
      const channel = await connection.createChannel();

      try {
        await assertOrderPlacedTopology(channel);
        await cleanDemoState(channel, event);

        const consumer = await startDuplicateConsumer(channel);
        void consumer.completed.catch(() => undefined);

        try {
          const publishChannel =
            await connection.createConfirmChannel();

          try {
            publishChannel.publish(
              ORDER_PLACED_TOPOLOGY.exchange,
              ORDER_PLACED_TOPOLOGY.routingKey,
              Buffer.from(JSON.stringify(event), 'utf8'),
              {
                persistent: true,
                contentType: 'application/json',
                contentEncoding: 'utf-8',
                messageId: event.eventId,
                type: event.type,
              },
            );
            await publishChannel.waitForConfirms();
            await consumer.completed;

            const workQueue = await channel.checkQueue(
              ORDER_PLACED_TOPOLOGY.queue,
            );
            const deadLetterQueue = await channel.checkQueue(
              ORDER_PLACED_TOPOLOGY.deadLetterQueue,
            );
            const effectRows = await dataSource.query<
              Array<{ count: number }>
            >(
              `
                SELECT count(*)::integer AS count
                FROM jobs
                WHERE event_id = $1
              `,
              [event.eventId],
            );
            const persistedEffect =
              effectRows[0]?.count ?? 0;

            console.log(
              `deliveries=${consumer.stats.deliveries}`,
            );
            console.log(`effect=${consumer.stats.effect}`);
            console.log(`skipped=${consumer.stats.skipped}`);

            const valid =
              consumer.stats.deliveries === 2 &&
              consumer.stats.effect === 1 &&
              consumer.stats.skipped === 1 &&
              consumer.stats.redelivered &&
              persistedEffect === 1 &&
              workQueue.messageCount === 0 &&
              deadLetterQueue.messageCount === 0;

            if (!valid) {
              throw new Error('demo:duplicate invariants failed');
            }
          } finally {
            await publishChannel.close();
          }
        } finally {
          consumer.stopWaiting(
            new Error('Duplicate demo consumer stopped'),
          );
          await channel.cancel(consumer.consumerTag);
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

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
