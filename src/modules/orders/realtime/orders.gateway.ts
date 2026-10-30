import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OrdersService } from '../services/orders.service.js';
import {
  joinOrderRoomSchema,
  socketAuthSchema,
} from './join-order-room.dto.js';
import { OnModuleDestroy } from '@nestjs/common';
import { OrderEventsService } from './order-events.service.js';
import { type Subscription } from 'rxjs';

type JoinAck =
  | { ok: true; room: string }
  | {
      ok: false;
      error: 'unauthorized' | 'invalid_payload' | 'forbidden';
    };

@WebSocketGateway()
export class OrdersGateway implements OnGatewayInit<Server>, OnModuleDestroy {
  private eventsSubscription?: Subscription;

  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderEventsService: OrderEventsService,
  ) {}

  @WebSocketServer()
  server!: Server;

  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<JoinAck> {
    const authResult = socketAuthSchema.safeParse(socket.handshake.auth);
    if (!authResult.success) {
      return { ok: false, error: 'unauthorized' };
    }

    const payloadResult = joinOrderRoomSchema.safeParse(body);
    if (!payloadResult.success) {
      return { ok: false, error: 'invalid_payload' };
    }

    const ownsOrder = await this.ordersService.isOwnedByCustomer(
      payloadResult.data.orderId,
      authResult.data.userId,
    );
    if (!ownsOrder) {
      return { ok: false, error: 'forbidden' };
    }

    const room = this.roomForOrder(payloadResult.data.orderId);
    await socket.join(room);

    return { ok: true, room };
  }

  afterInit(server: Server): void {
    this.eventsSubscription = this.orderEventsService.events$.subscribe(
      (event) => {
        const room = this.roomForOrder(event.orderId);

        server.to(room).emit('order.status', event);
      },
    );
  }

  onModuleDestroy(): void {
    this.eventsSubscription?.unsubscribe();
  }

  private roomForOrder(orderId: string): string {
    return `orders:${orderId}`;
  }
}
