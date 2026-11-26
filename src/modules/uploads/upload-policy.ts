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

export const MIN_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_MULTIPART_PARTS = 10_000;
export const MULTIPART_THRESHOLD_BYTES = 10 * 1024 * 1024;
export function calculatePartSize(fileSize: number): number {
  return Math.max(
    MIN_MULTIPART_PART_SIZE_BYTES,
    Math.ceil(fileSize / MAX_MULTIPART_PARTS),
  );
}
