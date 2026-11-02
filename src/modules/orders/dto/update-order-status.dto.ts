import z from 'zod';
import { OrderStatus } from '../../database/entities/order.entity.js';

export const updateOrderStatusSchema = z.strictObject({
  status: z.enum(OrderStatus),
});

export type UpdateOrderStatusDto = z.infer<typeof updateOrderStatusSchema>;
