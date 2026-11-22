export const ALLOWED_CONTENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/octet-stream': 'bin',
} as const;

export type AllowedContentType = keyof typeof ALLOWED_CONTENT_TYPES;

export const PRESIGNED_PUT_EXPIRES_IN_SECONDS = 300;
