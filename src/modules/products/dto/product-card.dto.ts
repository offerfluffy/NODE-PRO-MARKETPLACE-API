import { z } from 'zod';
import { ProductStatus } from '../../database/entities/product.entity.js';

export const productCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  priceCents: z.number().int().positive(),
  quantityAvailable: z.number().int().nonnegative(),
  unitsSold: z.number().int().nonnegative(),
  status: z.enum(ProductStatus),
  imageUrl: z.string().nullable(),
  sellerId: z.string(),
  sellerName: z.string(),
});

export type ProductCardDto = z.infer<typeof productCardSchema>;
