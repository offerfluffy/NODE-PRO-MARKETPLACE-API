import {
  connect,
  type Channel,
  type ConfirmChannel,
  type ConsumeMessage,
} from 'amqplib';
import type { DataSource } from 'typeorm';
import dataSource from '../src/modules/database/data-source.js';
import {
  assertOrderPlacedTopology,
  ORDER_PLACED_TOPOLOGY,
} from '../src/modules/messaging/rabbitmq/order-placed.topology.js';
import { ORDER_PLACED_PREFETCH } from '../src/modules/messaging/rabbitmq/order-placed.consumer.js';
import { applyOrderPlacedEffect } from '../src/modules/orders/events/apply-order-placed.effect.js';
import {
  orderPlacedEventSchema,
  type OrderPlacedEvent,
} from '../src/modules/orders/events/order-placed.event.js';

export const DEMO_PUBLISH_EVENT_COUNT = 5;

type QueryExecutor = Pick<DataSource, 'query'>;

type DemoPublishStats = {
  delivered: number;
  effect: number;
  acked: number;
};

type RunningDemoConsumer = {
  stats: DemoPublishStats;
  consumerTag: string;
  completed: Promise<void>;
};

export function createDemoPublishEvents(): OrderPlacedEvent[] {
  return Array.from({ length: DEMO_PUBLISH_EVENT_COUNT }, (_, index) => {
    const orderId = String(900_001 + index);

    return {
      eventId: `order.placed:${orderId}`,
      type: 'order.placed',
      occurredAt: new Date(`2026-11-02T12:00:0${index}.000Z`).toISOString(),
      data: {
        orderId,
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
  });
}

export async function handleDemoPublishMessage(
  channel: Channel,
  message: ConsumeMessage,
  stats: DemoPublishStats,
): Promise<void> {
  stats.delivered += 1;

  const body: unknown = JSON.parse(message.content.toString('utf8'));
  const event = orderPlacedEventSchema.parse(body);

  const result = await applyOrderPlacedEffect(dataSource, event);

  if (result === 'applied') {
    stats.effect += 1;
  }

  channel.ack(message);
  stats.acked += 1;
}

export async function startDemoPublishConsumer(
  channel: Channel,
): Promise<RunningDemoConsumer> {
  const stats: DemoPublishStats = {
    delivered: 0,
    effect: 0,
    acked: 0,
  };

  let resolveCompleted!: () => void;
  let rejectCompleted!: (error: unknown) => void;
  let timeout: ReturnType<typeof setTimeout> | undefined;

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
        rejectCompleted(new Error('RabbitMQ cancelled the demo consumer'));
        return;
      }

      void handleDemoPublishMessage(channel, message, stats)
        .then(() => {
          if (stats.acked === DEMO_PUBLISH_EVENT_COUNT) {
            resolveCompleted();
          }
        })
        .catch((error: unknown) => {
          try {
            channel.reject(message, false);
          } catch {
            // A closed channel will requeue unacknowledged work.
          }

          rejectCompleted(error);
        });
    },
    {
      noAck: false,
    },
  );

  timeout = setTimeout(() => {
    rejectCompleted(
      new Error(
        `Timed out waiting for ${DEMO_PUBLISH_EVENT_COUNT} acknowledgements`,
      ),
    );
  }, 10_000);

  return {
    stats,
    consumerTag,
    completed,
  };
}

export async function publishDemoEvents(
  channel: ConfirmChannel,
  events: OrderPlacedEvent[],
): Promise<number> {
  for (const event of events) {
    channel.publish(
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
  }

  await channel.waitForConfirms();

  return events.length;
}

export async function cleanDemoPublishState(
  executor: QueryExecutor,
  channel: Channel,
  events: OrderPlacedEvent[],
): Promise<void> {
  const workQueue = await channel.checkQueue(ORDER_PLACED_TOPOLOGY.queue);

  if (workQueue.consumerCount !== 0) {
    throw new Error(
      `Expected no competing consumers, found ${workQueue.consumerCount}. Stop the API before running demo:publish.`,
    );
  }

  await channel.purgeQueue(ORDER_PLACED_TOPOLOGY.queue);
  await channel.purgeQueue(ORDER_PLACED_TOPOLOGY.deadLetterQueue);

  await executor.query(
    `
      DELETE FROM jobs
      WHERE event_id = ANY($1::text[])
    `,
    [events.map((event) => event.eventId)],
  );
}

async function main(): Promise<void> {
  const events = createDemoPublishEvents();

  await dataSource.initialize();

  try {
    const connection = await connect(requiredEnv('BROKER_URL'));

    try {
      const channel = await connection.createChannel();

      try {
        await assertOrderPlacedTopology(channel);
        await cleanDemoPublishState(dataSource, channel, events);

        const publishChannel = await connection.createConfirmChannel();

        try {
          const consumer = await startDemoPublishConsumer(channel);

          void consumer.completed.catch(() => undefined);

          try {
            const published = await publishDemoEvents(publishChannel, events);

            await consumer.completed;

            const workQueue = await channel.checkQueue(
              ORDER_PLACED_TOPOLOGY.queue,
            );
            const deadLetterQueue = await channel.checkQueue(
              ORDER_PLACED_TOPOLOGY.deadLetterQueue,
            );

            const effectRows = await dataSource.query<Array<{ count: number }>>(
              `
                SELECT count(*)::integer AS count
                FROM jobs
                WHERE event_id = ANY($1::text[])
              `,
              [events.map((event) => event.eventId)],
            );

            const persistedEffect = effectRows[0]?.count ?? 0;

            console.log(`published=${published}`);
            console.log(`delivered=${consumer.stats.delivered}`);
            console.log(`effect=${consumer.stats.effect}`);
            console.log(`acked=${consumer.stats.acked}`);
            console.log(`dlq=${deadLetterQueue.messageCount}`);
            console.log(`prefetch=${ORDER_PLACED_PREFETCH}`);

            const valid =
              published === DEMO_PUBLISH_EVENT_COUNT &&
              consumer.stats.delivered === DEMO_PUBLISH_EVENT_COUNT &&
              consumer.stats.effect === DEMO_PUBLISH_EVENT_COUNT &&
              consumer.stats.acked === DEMO_PUBLISH_EVENT_COUNT &&
              persistedEffect === DEMO_PUBLISH_EVENT_COUNT &&
              workQueue.messageCount === 0 &&
              deadLetterQueue.messageCount === 0;

            if (!valid) {
              throw new Error('demo:publish invariants failed');
            }
          } finally {
            await channel.cancel(consumer.consumerTag);
          }
        } finally {
          await publishChannel.close();
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

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
