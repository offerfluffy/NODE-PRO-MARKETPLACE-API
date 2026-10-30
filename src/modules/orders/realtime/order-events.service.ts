import { Injectable } from '@nestjs/common';
import { filter, Subject, type Observable } from 'rxjs';
import { type OrderStatus } from '../../database/entities/order.entity.js';

export type OrderStatusChangedEvent = {
  id: number;
  orderId: string;
  status: OrderStatus;
};

@Injectable()
export class OrderEventsService {
  private readonly bufferLimit = 100;

  private readonly eventsByOrder = new Map<string, OrderStatusChangedEvent[]>();
  private readonly lastEventIdByOrder = new Map<string, number>();

  private readonly subject = new Subject<OrderStatusChangedEvent>();
  readonly events$ = this.subject.asObservable();

  public publish(
    orderId: string,
    status: OrderStatus,
  ): OrderStatusChangedEvent {
    const lastEventId = this.lastEventIdByOrder.get(orderId);

    const nextId = (lastEventId ?? 0) + 1;

    this.lastEventIdByOrder.set(orderId, nextId);

    const event = {
      id: nextId,
      orderId,
      status,
    };

    const bufferedEvents = [...(this.eventsByOrder.get(orderId) ?? [])];
    bufferedEvents.push(event);

    if (bufferedEvents.length > this.bufferLimit) {
      bufferedEvents.shift();
    }

    this.eventsByOrder.set(orderId, bufferedEvents);
    this.subject.next(event);

    return event;
  }

  public eventsFor(orderId: string): Observable<OrderStatusChangedEvent> {
    return this.events$.pipe(filter((event) => event.orderId === orderId));
  }

  public eventsAfter(
    orderId: string,
    lastEventId: number,
  ): OrderStatusChangedEvent[] {
    const bufferedEvents = (this.eventsByOrder.get(orderId) ?? []).filter(
      (event) => event.id > lastEventId,
    );
    return bufferedEvents;
  }
}
