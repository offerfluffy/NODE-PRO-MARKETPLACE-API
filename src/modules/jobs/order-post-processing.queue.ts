export const ORDER_POST_PROCESSING_QUEUE =
  'order-post-processing';

export const ORDER_POST_PROCESSING_JOB =
  'process-order';

export type OrderPostProcessingJobData = {
  eventId: string;
  orderId: string;
  customerId: string;
};

export function orderPostProcessingJobId(
  orderId: string,
): string {
  return `order-placed-${orderId}`;
} 