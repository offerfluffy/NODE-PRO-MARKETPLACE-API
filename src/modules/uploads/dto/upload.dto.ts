import { z } from 'zod';
import {
  ALLOWED_CONTENT_TYPES,
  type AllowedContentType,
} from '../upload-policy.js';

const allowedContentTypeKeys = Object.keys(ALLOWED_CONTENT_TYPES) as [
  AllowedContentType,
  ...AllowedContentType[],
];

export const createUploadIntentSchema = z.object({
  contentType: z.enum(allowedContentTypeKeys),
  size: z.number().int().positive(),
  filename: z.string().optional(),
});

export type CreateUploadIntentDto = z.infer<typeof createUploadIntentSchema>;

export const fileIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/, 'fileId must be a positive integer string');

export const commitUploadSchema = z.object({
  fileId: fileIdSchema,
});

export type CommitUploadDto = z.infer<typeof commitUploadSchema>;
