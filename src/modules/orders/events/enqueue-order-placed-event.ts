import { EntityManager } from 'typeorm';
import { OrderPlacedEvent } from './order-placed.event.js';
import { OutboxEvent } from '../../database/entities/outboxEvent.entity.js';

export async function enqueueOrderPlacedEvent(
  manager: EntityManager,
  event: OrderPlacedEvent,
): Promise<void> {
  await manager.insert(OutboxEvent, {
    aggregateType: 'Order',
    aggregateId: event.data.orderId,
    type: event.type,
    payload: event,
  });
}
