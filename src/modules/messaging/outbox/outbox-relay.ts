import { DataSource } from 'typeorm';
import {
  OrderPlacedEvent,
  orderPlacedEventSchema,
} from '../../orders/events/order-placed.event.js';

type OutboxRow = {
  id: string;
  type: string;
  payload: unknown;
};

type PublishOrderPlaced = (event: OrderPlacedEvent) => Promise<void>;

export async function relayOutboxBatch(
  dataSource: DataSource,
  publish: PublishOrderPlaced,
  batchSize: number,
): Promise<number> {
  return dataSource.transaction(async (manager) => {
    const unpublishedRows = await manager.query<OutboxRow[]>(
      `
        SELECT id, type, payload
        FROM outbox
        WHERE published_at IS NULL
        ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      `,
      [batchSize],
    );

    let publishedRows = 0;

    for (const row of unpublishedRows) {
      if (row.type !== 'order.placed') {
        throw new Error(`Unsupported outbox event type: ${row.type}`);
      }

      const event = orderPlacedEventSchema.parse(row.payload);

      await publish(event);

      await manager.query(
        `
          UPDATE outbox
          SET published_at = now(),
              attempts = attempts + 1
          WHERE id = $1
        `,
        [row.id],
      );

      publishedRows++;
    }

    return publishedRows;
  });
}
