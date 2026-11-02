import type { DataSource } from 'typeorm';
import type { OrderPlacedEvent } from './order-placed.event.js';

type QueryExecutor = Pick<DataSource, 'query'>;

type InsertedJobRow = {
  id: string;
};

export type OrderPlacedEffectResult = 'applied' | 'skipped';

export async function applyOrderPlacedEffect(
  executor: QueryExecutor,
  event: OrderPlacedEvent,
): Promise<OrderPlacedEffectResult> {
  const insertedJobs = await executor.query<InsertedJobRow[]>(
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
}
