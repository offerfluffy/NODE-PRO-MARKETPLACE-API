import { EntityManager } from 'typeorm';
import dataSource from '../src/database/data-source.js';

export type RetryResult<T> = {
  value: T;
  retries: number;
};

const RETRYABLE_CODES = new Set(['40001', '40P01']);

export async function withTransactionRetry<T>(
  label: string,
  operation: (manager: EntityManager) => Promise<T>,
  maxAttempts = 5,
): Promise<RetryResult<T>> {
  let retries = 0;

  for (;;) {
    try {
      const value = await dataSource.transaction(
        'REPEATABLE READ',
        async (manager) => operation(manager),
      );

      return {
        value,
        retries,
      };
    } catch (error) {
      const errorCode = getErrorCode(error);

      if (!errorCode || !RETRYABLE_CODES.has(errorCode)) throw error;

      if (retries >= maxAttempts - 1) {
        throw error;
      }

      retries += 1;

      const baseDelayMs = 25 * 2 ** (retries - 1);
      const jitterMs = Math.floor(Math.random() * 25);
      const delayMs = baseDelayMs + jitterMs;

      console.log(
        `${label}: retry ${retries}/${maxAttempts - 1} after ${errorCode}; ` +
          `backoff ${delayMs} ms`,
      );

      await sleep(delayMs);
      continue;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }

  return undefined;
}
