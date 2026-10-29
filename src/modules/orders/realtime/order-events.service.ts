import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { type OrderStatus } from '../../database/entities/order.entity.js';

export type OrderStatusChangedEvent = {
  id: number;
  orderId: string;
  status: OrderStatus;
};

@Injectable()
export class OrderEventsService {
  private readonly subject = new Subject<OrderStatusChangedEvent>();
  readonly events$ = this.subject.asObservable();
}
