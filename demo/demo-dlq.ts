import {
  connect,
  type Channel,
  type ConsumeMessage,
  type GetMessage,
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

const POISON_EVENT_ID = 'order.placed:900101';
const TIMEOUT_MS = 10_000;

type PoisonConsumer = {
  consumerTag: string;
  stats: { rejected: number };
  completed: Promise<void>;
  stopWaiting: (error: Error) => void;
};

function createPoisonPayload(): unknown {
  return {
    eventId: POISON_EVENT_ID,
    type: 'order.placed',
    occurredAt: '2026-11-02T12:10:00.000Z',
    data: {
      orderId: '900101',
      customerId: '900001',
      totalAmountCents: 7_500,
      items: [],
    },
  };
}

async function cleanDemoState(channel: Channel): Promise<void> {
  const workQueue = await channel.checkQueue(
    ORDER_PLACED_TOPOLOGY.queue,
  );

  if (workQueue.consumerCount !== 0) {
    throw new Error(
      `Expected no competing consumers, found ${workQueue.consumerCount}. Stop the API before running demo:dlq.`,
    );
  }

  await channel.purgeQueue(ORDER_PLACED_TOPOLOGY.queue);
  await channel.purgeQueue(
    ORDER_PLACED_TOPOLOGY.deadLetterQueue,
  );
  await dataSource.query(
    'DELETE FROM jobs WHERE event_id = $1',
    [POISON_EVENT_ID],
  );
}

async function startPoisonConsumer(
  channel: Channel,
): Promise<PoisonConsumer> {
  const stats = { rejected: 0 };
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
        fail(new Error('RabbitMQ cancelled the DLQ demo consumer'));
        return;
      }

      handlePoisonMessage(channel, message, stats, succeed, fail);
    },
    { noAck: false },
  );

  timeout = setTimeout(() => {
    fail(new Error('Timed out waiting for poison-message rejection'));
  }, TIMEOUT_MS);

  return {
    consumerTag,
    stats,
    completed,
    stopWaiting: fail,
  };
}

function handlePoisonMessage(
  channel: Channel,
  message: ConsumeMessage,
  stats: { rejected: number },
  succeed: () => void,
  fail: (error: unknown) => void,
): void {
  let event: OrderPlacedEvent;

  try {
    const body: unknown = JSON.parse(
      message.content.toString('utf8'),
    );
    event = orderPlacedEventSchema.parse(body);
  } catch {
    channel.reject(message, false);
    stats.rejected += 1;
    succeed();
    return;
  }

  void applyOrderPlacedEffect(dataSource, event)
    .then(() => {
      channel.ack(message);
      fail(new Error('Poison payload unexpectedly passed validation'));
    })
    .catch(fail);
}

async function getDlqMessage(
  channel: Channel,
): Promise<GetMessage> {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    const message = await channel.get(
      ORDER_PLACED_TOPOLOGY.deadLetterQueue,
      { noAck: false },
    );

    if (message) {
      return message;
    }

    await delay(50);
  }

  throw new Error('Timed out waiting for a message in the DLQ');
}

function readDeadLetterReason(message: GetMessage): string {
  const headers = message.properties.headers ?? {};
  const firstReason = headers['x-first-death-reason'];

  if (typeof firstReason === 'string') {
    return firstReason;
  }

  const deaths = headers['x-death'];

  if (Array.isArray(deaths)) {
    const reason = deaths[0]?.reason;

    if (typeof reason === 'string') {
      return reason;
    }
  }

  throw new Error('DLQ message has no readable x-death reason');
}

async function waitForQueueDepth(
  channel: Channel,
  queue: string,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    const state = await channel.checkQueue(queue);

    if (state.messageCount === expected) {
      return;
    }

    await delay(50);
  }

  throw new Error(
    `Timed out waiting for ${queue} depth=${expected}`,
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function main(): Promise<void> {
  await dataSource.initialize();

  try {
    const connection = await connect(requiredEnv('BROKER_URL'));

    try {
      const channel = await connection.createChannel();

      try {
        await assertOrderPlacedTopology(channel);
        await cleanDemoState(channel);

        const consumer = await startPoisonConsumer(channel);
        void consumer.completed.catch(() => undefined);

        try {
          const publishChannel =
            await connection.createConfirmChannel();

          try {
            const payload = createPoisonPayload();

            publishChannel.publish(
              ORDER_PLACED_TOPOLOGY.exchange,
              ORDER_PLACED_TOPOLOGY.routingKey,
              Buffer.from(JSON.stringify(payload), 'utf8'),
              {
                persistent: true,
                contentType: 'application/json',
                contentEncoding: 'utf-8',
                messageId: POISON_EVENT_ID,
                type: 'order.placed',
              },
            );
            await publishChannel.waitForConfirms();
            await consumer.completed;

            const dlqMessage = await getDlqMessage(channel);
            const deadLetterReason = readDeadLetterReason(dlqMessage);

            channel.nack(dlqMessage, false, true);
            await waitForQueueDepth(
              channel,
              ORDER_PLACED_TOPOLOGY.deadLetterQueue,
              1,
            );

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
              [POISON_EVENT_ID],
            );
            const effect = effectRows[0]?.count ?? 0;

            console.log(`rejected=${consumer.stats.rejected}`);
            console.log(`work=${workQueue.messageCount}`);
            console.log(`dlq=${deadLetterQueue.messageCount}`);
            console.log(`dlq-reason=${deadLetterReason}`);
            console.log(`effect=${effect}`);

            const valid =
              consumer.stats.rejected === 1 &&
              workQueue.messageCount === 0 &&
              deadLetterQueue.messageCount === 1 &&
              deadLetterReason === 'rejected' &&
              effect === 0;

            if (!valid) {
              throw new Error('demo:dlq invariants failed');
            }
          } finally {
            await publishChannel.close();
          }
        } finally {
          consumer.stopWaiting(
            new Error('DLQ demo consumer stopped'),
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
