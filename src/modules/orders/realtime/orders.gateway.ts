import {
  ConnectedSocket,
  MessageBody,
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

type JoinAck =
  | { ok: true; room: string }
  | {
      ok: false;
      error: 'unauthorized' | 'invalid_payload' | 'forbidden';
    };

@WebSocketGateway()
export class OrdersGateway {
  constructor(private readonly ordersService: OrdersService) {}

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

    const room = `orders:${payloadResult.data.orderId}`;
    await socket.join(room);

    return { ok: true, room };
  }
}
