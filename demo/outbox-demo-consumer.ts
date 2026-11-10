import type { Channel, ConsumeMessage } from 'amqplib';
import type { DataSource } from 'typeorm';
import {
  assertOrderPlacedTopology,
  ORDER_PLACED_TOPOLOGY,
} from '../src/modules/messaging/rabbitmq/order-placed.topology.js';
import { applyOrderPlacedEffect } from '../src/modules/orders/events/apply-order-placed.effect.js';
import { orderPlacedEventSchema } from '../src/modules/orders/events/order-placed.event.js';

const DEMO_CONSUMER_TIMEOUT_MS = 10_000;

export type OutboxDemoConsumerStats = {
  deliveries: number;
  applied: number;
  skipped: number;
};

export type RunningOutboxDemoConsumer = {
  stats: OutboxDemoConsumerStats;
  consumerTag: string;
  completed: Promise<void>;
  stopWaiting: (error: Error) => void;
};

export async function prepareOutboxDemoBroker(channel: Channel): Promise<void> {
  await assertOrderPlacedTopology(channel);

  const workQueue = await channel.checkQueue(ORDER_PLACED_TOPOLOGY.queue);

  if (workQueue.consumerCount !== 0) {
    throw new Error(
      `Expected no competing consumers, found ${workQueue.consumerCount}. Stop the API and other messaging demos.`,
    );
  }

  await channel.purgeQueue(ORDER_PLACED_TOPOLOGY.queue);
  await channel.purgeQueue(ORDER_PLACED_TOPOLOGY.deadLetterQueue);
}

export async function startOutboxDemoConsumer(
  channel: Channel,
  dataSource: DataSource,
  expectedDeliveries: number,
): Promise<RunningOutboxDemoConsumer> {
  if (!Number.isInteger(expectedDeliveries) || expectedDeliveries <= 0) {
    throw new Error('Expected deliveries must be a positive integer');
  }

  await channel.prefetch(1);

  const stats: OutboxDemoConsumerStats = {
    deliveries: 0,
    applied: 0,
    skipped: 0,
  };
  let settled = false;
  let resolveCompleted!: () => void;
  let rejectCompleted!: (error: unknown) => void;
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

  timeout = setTimeout(() => {
    fail(
      new Error(
        `Timed out waiting for ${expectedDeliveries} outbox deliveries`,
      ),
    );
  }, DEMO_CONSUMER_TIMEOUT_MS);

  let consumerTag: string;

  try {
    ({ consumerTag } = await channel.consume(
      ORDER_PLACED_TOPOLOGY.queue,
      (message) => {
        if (!message) {
          fail(new Error('RabbitMQ cancelled the outbox demo consumer'));
          return;
        }

        void handleOutboxDemoMessage(channel, message, dataSource, stats)
          .then(() => {
            if (stats.deliveries === expectedDeliveries) {
              succeed();
            } else if (stats.deliveries > expectedDeliveries) {
              fail(
                new Error(
                  `Expected ${expectedDeliveries} deliveries, received ${stats.deliveries}`,
                ),
              );
            }
          })
          .catch((error: unknown) => {
            try {
              channel.reject(message, false);
            } catch {
              // A closed channel will requeue unacknowledged work.
            }

            fail(error);
          });
      },
      { noAck: false },
    ));
  } catch (error) {
    if (timeout) {
      clearTimeout(timeout);
    }

    throw error;
  }

  return {
    stats,
    consumerTag,
    completed,
    stopWaiting: fail,
  };
}

async function handleOutboxDemoMessage(
  channel: Channel,
  message: ConsumeMessage,
  dataSource: DataSource,
  stats: OutboxDemoConsumerStats,
): Promise<void> {
  stats.deliveries += 1;

  const body: unknown = JSON.parse(message.content.toString('utf8'));
  const event = orderPlacedEventSchema.parse(body);
  const result = await applyOrderPlacedEffect(dataSource, event);

  if (result === 'applied') {
    stats.applied += 1;
  } else {
    stats.skipped += 1;
  }

  channel.ack(message);
}
