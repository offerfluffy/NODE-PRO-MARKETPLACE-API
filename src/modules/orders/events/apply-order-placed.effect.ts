import type { DataSource } from 'typeorm';
import type { OrderPlacedEvent } from './order-placed.event.js';

type TransactionExecutor = Pick<DataSource, 'transaction'>;

type InsertedJobRow = {
  id: string;
};

type InsertedMessageRow = {
  message_id: string;
};

export type OrderPlacedEffectResult = 'applied' | 'skipped';
export const ORDER_PLACED_EFFECT_CONSUMER = 'order-placed-job';

export async function applyOrderPlacedEffect(
  executor: TransactionExecutor,
  event: OrderPlacedEvent,
): Promise<OrderPlacedEffectResult> {
  return executor.transaction(async (manager) => {
    const insertedMessages = await manager.query<InsertedMessageRow[]>(
      `
        INSERT INTO processed_messages (message_id, consumer)
        VALUES ($1, $2)
        ON CONFLICT (message_id, consumer) DO NOTHING
        RETURNING message_id
      `,
      [event.eventId, ORDER_PLACED_EFFECT_CONSUMER],
    );

    if (!insertedMessages[0]) {
      return 'skipped';
    }

    const insertedJobs = await manager.query<InsertedJobRow[]>(
      `
      INSERT INTO jobs (
        event_id,
        type,
        payload
      )
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id
    `,
      [
        event.eventId,
        'order_post_processing',
        JSON.stringify({
          orderId: event.data.orderId,
          customerId: event.data.customerId,
        }),
      ],
    );

    return insertedJobs[0] ? 'applied' : 'skipped';
  });
}
