import { Job } from '../../src/modules/database/entities/job.entity.js';
import { applyOrderPlacedEffect } from '../../src/modules/orders/events/apply-order-placed.effect.js';
import type { OrderPlacedEvent } from '../../src/modules/orders/events/order-placed.event.js';
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from './testkit/postgres.js';

describe('Order placed effect integration', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await startTestDatabase();
  });

  afterAll(async () => {
    if (database) {
      await stopTestDatabase(database);
    }
  });

  it('applies an event once and skips its duplicate', async () => {
    if (!database) {
      throw new Error('Test database was not initialized');
    }

    const event: OrderPlacedEvent = {
      eventId: 'order.placed:1001',
      type: 'order.placed',
      occurredAt: '2026-11-02T00:00:00.000Z',
      data: {
        orderId: '1001',
        customerId: '2001',
        totalAmountCents: 12_900,
        items: [
          {
            productId: '3001',
            quantity: 1,
            unitPriceCents: 12_900,
          },
        ],
      },
    };

    const firstResult = await applyOrderPlacedEffect(
      database.dataSource,
      event,
    );
    const secondResult = await applyOrderPlacedEffect(
      database.dataSource,
      event,
    );
    const jobCount = await database.dataSource
      .getRepository(Job)
      .countBy({ eventId: event.eventId });

    expect(firstResult).toBe('applied');
    expect(secondResult).toBe('skipped');
    expect(jobCount).toBe(1);
  });
});
