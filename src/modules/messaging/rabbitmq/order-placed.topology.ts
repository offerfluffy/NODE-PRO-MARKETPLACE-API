import type { Channel } from 'amqplib';

export const ORDER_PLACED_TOPOLOGY = {
  exchange: 'shop.events',
  routingKey: 'order.placed',
  queue: 'shop.order-placed',

  deadLetterExchange: 'shop.events.dlx',
  deadLetterRoutingKey: 'order.placed.dead',
  deadLetterQueue: 'shop.order-placed.dlq',
} as const;

export async function assertOrderPlacedTopology(
  channel: Channel,
): Promise<void> {
  await channel.assertExchange(ORDER_PLACED_TOPOLOGY.exchange, 'topic', {
    durable: true,
  });

  await channel.assertExchange(
    ORDER_PLACED_TOPOLOGY.deadLetterExchange,
    'direct',
    { durable: true },
  );

  await channel.assertQueue(ORDER_PLACED_TOPOLOGY.deadLetterQueue, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
    },
  });

  await channel.bindQueue(
    ORDER_PLACED_TOPOLOGY.deadLetterQueue,
    ORDER_PLACED_TOPOLOGY.deadLetterExchange,
    ORDER_PLACED_TOPOLOGY.deadLetterRoutingKey,
  );

  await channel.assertQueue(ORDER_PLACED_TOPOLOGY.queue, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': ORDER_PLACED_TOPOLOGY.deadLetterExchange,
      'x-dead-letter-routing-key': ORDER_PLACED_TOPOLOGY.deadLetterRoutingKey,
    },
  });

  await channel.bindQueue(
    ORDER_PLACED_TOPOLOGY.queue,
    ORDER_PLACED_TOPOLOGY.exchange,
    ORDER_PLACED_TOPOLOGY.routingKey,
  );
}
