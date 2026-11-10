import { Job } from '../../src/modules/database/entities/job.entity.js';
import { ProcessedMessage } from '../../src/modules/database/entities/processedMessage.entity.js';
import {
  applyOrderPlacedEffect,
  ORDER_PLACED_EFFECT_CONSUMER,
} from '../../src/modules/orders/events/apply-order-placed.effect.js';
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

  it('stores one inbox marker and one effect after duplicate delivery', async () => {
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
    const processedCount = await database.dataSource
      .getRepository(ProcessedMessage)
      .countBy({
        messageId: event.eventId,
        consumer: ORDER_PLACED_EFFECT_CONSUMER,
      });

    expect(firstResult).toBe('applied');
    expect(secondResult).toBe('skipped');
    expect(jobCount).toBe(1);
    expect(processedCount).toBe(1);
  });

  it('skips the effect when the inbox marker already exists', async () => {
    if (!database) {
      throw new Error('Test database was not initialized');
    }

    const event: OrderPlacedEvent = {
      eventId: 'order.placed:1002',
      type: 'order.placed',
      occurredAt: '2026-11-02T00:01:00.000Z',
      data: {
        orderId: '1002',
        customerId: '2001',
        totalAmountCents: 8_500,
        items: [
          {
            productId: '3002',
            quantity: 1,
            unitPriceCents: 8_500,
          },
        ],
      },
    };

    await database.dataSource.getRepository(ProcessedMessage).insert({
      messageId: event.eventId,
      consumer: ORDER_PLACED_EFFECT_CONSUMER,
    });

    const result = await applyOrderPlacedEffect(database.dataSource, event);
    const jobCount = await database.dataSource
      .getRepository(Job)
      .countBy({ eventId: event.eventId });

    expect(result).toBe('skipped');
    expect(jobCount).toBe(0);
  });
});
