import { Injectable } from '@nestjs/common';
import { filter, Subject, type Observable } from 'rxjs';
import { DataSource, MoreThan, type Repository } from 'typeorm';
import { type OrderStatus } from '../../database/entities/order.entity.js';
import { OrderStatusEvent } from '../../database/entities/orderStatusEvent.entity.js';

export type OrderStatusChangedEvent = {
  id: number;
  orderId: string;
  status: OrderStatus;
};

@Injectable()
export class OrderEventsService {
  private readonly subject = new Subject<OrderStatusChangedEvent>();
  private readonly orderStatusEvents: Repository<OrderStatusEvent>;
  readonly events$ = this.subject.asObservable();

  constructor(dataSource: DataSource) {
    this.orderStatusEvents = dataSource.getRepository(OrderStatusEvent);
  }

  public async publish(
    orderId: string,
    status: OrderStatus,
  ): Promise<OrderStatusChangedEvent> {
    const persistedEvent = await this.orderStatusEvents.save(
      this.orderStatusEvents.create({ order: { id: orderId }, status }),
    );

    const event = this.toEvent(persistedEvent);
    this.subject.next(event);

    return event;
  }

  public eventsFor(orderId: string): Observable<OrderStatusChangedEvent> {
    return this.events$.pipe(filter((event) => event.orderId === orderId));
  }

  public async eventsAfter(
    orderId: string,
    lastEventId: number,
  ): Promise<OrderStatusChangedEvent[]> {
    const persistedEvents = await this.orderStatusEvents.find({
      where: {
        order: { id: orderId },
        id: MoreThan(String(lastEventId)),
      },
      order: { id: 'ASC' },
      relations: { order: true },
    });

    return persistedEvents.map((event) => this.toEvent(event));
  }

  private toEvent(persistedEvent: OrderStatusEvent): OrderStatusChangedEvent {
    const id = Number(persistedEvent.id);
    if (!Number.isSafeInteger(id)) {
      throw new Error(
        `Order event id ${persistedEvent.id} exceeds JavaScript safe integer range`,
      );
    }

    return {
      id,
      orderId: persistedEvent.order.id,
      status: persistedEvent.status,
    };
  }
}
