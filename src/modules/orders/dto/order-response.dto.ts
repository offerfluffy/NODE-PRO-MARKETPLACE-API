import { z } from 'zod';
import { OrderStatus } from '../../database/entities/order.entity.js';

export const orderItemResponseSchema = z.object({
  product_id: z.string(),
  quantity: z.number().int().positive(),
  price_cents: z.number().int().positive(),
});

export const orderResponseSchema = z.object({
  id: z.string(),
  customer_id: z.string(),
  status: z.enum(OrderStatus),
  total_cents: z.number().int().positive(),
  items: z.array(orderItemResponseSchema),
});

export type OrderItemResponseDto = z.infer<typeof orderItemResponseSchema>;

export type OrderResponseDto = z.infer<typeof orderResponseSchema>;
