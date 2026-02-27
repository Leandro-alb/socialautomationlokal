import { logger } from './logger';

export interface RetryOptions {
  attempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  operationName?: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export async function withRetry<T>(
  fn: () => Promise<T>,
  {
    attempts = 3,
    minDelayMs = 500,
    maxDelayMs = 4000,
    factor = 2,
    operationName = 'operation'
  }: RetryOptions = {}
): Promise<T> {
  let lastError: unknown;

  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i === attempts) {
        break;
      }

      const jitter = Math.floor(Math.random() * 200);
      const delay = Math.min(minDelayMs * factor ** (i - 1), maxDelayMs) + jitter;
      logger.warn(
        `${operationName} failed (attempt ${i}/${attempts}), retrying in ${delay}ms`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
