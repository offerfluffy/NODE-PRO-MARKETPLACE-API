import { z } from 'zod';
import { ProductStatus } from '../../database/entities/product.entity.js';

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2_000),
    price_cents: z.number().int().positive(),
    quantity_available: z.number().int().nonnegative(),
    status: z.enum(ProductStatus),
    image_url: z.url().nullable(),
  })
  .strict();

export type CreateProductDto = z.infer<typeof createProductSchema>;
