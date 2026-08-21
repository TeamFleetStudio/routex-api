import { sleep } from '../../utils/time.js';
import { logger } from '../../utils/logger.js';
import type { FailureClassifierService } from './failure-classifier.service.js';

export interface RetryOptions {
  retryCount: number;
  baseDelayMs?: number;
  source?: string;
}

export class RetryService {
  constructor(private readonly classifier: FailureClassifierService) {}

  async execute<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
    const maxAttempts = Math.max(1, options.retryCount + 1);
    const baseDelayMs = options.baseDelayMs ?? 200;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const classified = this.classifier.classify(err);
        const shouldRetry = classified.retryable && attempt < maxAttempts;

        logger.warn({
          event: 'SOURCE_RETRY',
          source: options.source,
          attempt,
          max_attempts: maxAttempts,
          failure_kind: classified.kind,
          will_retry: shouldRetry,
        });

        if (!shouldRetry) {
          throw err;
        }

        const delay = this.backoffWithJitter(baseDelayMs, attempt);
        const retryAfter = classified.retryAfterMs;
        await sleep(retryAfter !== undefined ? Math.max(delay, retryAfter) : delay);
      }
    }

    throw lastError;
  }

  backoffWithJitter(baseDelayMs: number, attempt: number): number {
    const exp = baseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * baseDelayMs);
    return exp + jitter;
  }

  shouldRetry(error: unknown, attempt: number, maxAttempts: number): boolean {
    if (attempt >= maxAttempts) return false;
    return this.classifier.classify(error).retryable;
  }
}
