import z from 'zod';
import { postgresBigintIdSchema } from '../dto/create-order.dto.js';

export const joinOrderRoomSchema = z.strictObject({
  orderId: postgresBigintIdSchema,
});

export const socketAuthSchema = z.strictObject({
  userId: postgresBigintIdSchema,
});

export type JoinOrderRoomDto = z.infer<typeof joinOrderRoomSchema>;
export type SocketAuthDto = z.infer<typeof socketAuthSchema>;
