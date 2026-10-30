import z from 'zod';
import { postgresBigintIdSchema } from '../dto/create-order.dto.js';

export const joinOrderRoomSchema = z.strictObject({
  orderId: postgresBigintIdSchema,
});

export type JoinOrderRoomDto = z.infer<typeof joinOrderRoomSchema>;
