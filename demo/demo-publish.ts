import type { Channel } from 'amqplib';
import type { DataSource } from 'typeorm';
import { ORDER_PLACED_TOPOLOGY } from '../src/modules/messaging/rabbitmq/order-placed.topology.js';
import type { OrderPlacedEvent } from '../src/modules/orders/events/order-placed.event.js';

export const DEMO_PUBLISH_EVENT_COUNT = 5;

type QueryExecutor = Pick<DataSource, 'query'>;

export function createDemoPublishEvents(): OrderPlacedEvent[] {
  return Array.from(
    { length: DEMO_PUBLISH_EVENT_COUNT },
    (_, index) => {
      const orderId = String(900_001 + index);

      return {
        eventId: `order.placed:${orderId}`,
        type: 'order.placed',
        occurredAt: new Date(
          `2026-11-02T12:00:0${index}.000Z`,
        ).toISOString(),
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
    },
  );
}

export async function cleanDemoPublishState(
  executor: QueryExecutor,
  channel: Channel,
  events: OrderPlacedEvent[],
): Promise<void> {
  const workQueue = await channel.checkQueue(
    ORDER_PLACED_TOPOLOGY.queue,
  );

  if (workQueue.consumerCount !== 0) {
    throw new Error(
      `Expected no competing consumers, found ${workQueue.consumerCount}. Stop the API before running demo:publish.`,
    );
  }

  await channel.purgeQueue(ORDER_PLACED_TOPOLOGY.queue);
  await channel.purgeQueue(
    ORDER_PLACED_TOPOLOGY.deadLetterQueue,
  );

  await executor.query(
    `
      DELETE FROM jobs
      WHERE event_id = ANY($1::text[])
    `,
    [events.map((event) => event.eventId)],
  );
}
