import { describe, expect, it } from 'vitest';
import { FailureClassifierService } from '../src/services/resilience/failure-classifier.service.js';
import { RetryService } from '../src/services/resilience/retry.service.js';
import {
  ExternalApiError,
  NormalizationError,
  SourceTimeoutError,
  ValidationError,
} from '../src/errors/index.js';

describe('failure classification', () => {
  const classifier = new FailureClassifierService();

  it('classifies timeouts as retryable', () => {
    const result = classifier.classify(new SourceTimeoutError('redbus'));
    expect(result.kind).toBe('TIMEOUT');
    expect(result.retryable).toBe(true);
    expect(result.mayTriggerSelfHealing).toBe(false);
  });

  it('classifies rate limits as retryable', () => {
    const result = classifier.classify(new ExternalApiError('redbus', 'limited', 429));
    expect(result.kind).toBe('RATE_LIMITED');
    expect(result.retryable).toBe(true);
  });

  it('classifies normalization failures as self-healing candidates', () => {
    const result = classifier.classify(new NormalizationError('redbus', 'bad shape'));
    expect(result.kind).toBe('DATA_EXTRACTION_FAILED');
    expect(result.mayTriggerSelfHealing).toBe(true);
    expect(result.retryable).toBe(false);
  });

  it('does not retry invalid requests', () => {
    const result = classifier.classify(new ValidationError('bad'));
    expect(result.kind).toBe('INVALID_REQUEST');
    expect(result.retryable).toBe(false);
  });
});

describe('retry decisions', () => {
  const retry = new RetryService(new FailureClassifierService());

  it('retries retryable errors then succeeds', async () => {
    let attempts = 0;
    const value = await retry.execute(
      async () => {
        attempts += 1;
        if (attempts < 2) throw new SourceTimeoutError('redbus');
        return 'ok';
      },
      { retryCount: 2, baseDelayMs: 1, source: 'redbus' },
    );
    expect(value).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('does not retry non-retryable errors', async () => {
    await expect(
      retry.execute(
        async () => {
          throw new ValidationError('nope');
        },
        { retryCount: 3, baseDelayMs: 1 },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('computes backoff with jitter', () => {
    const delay = retry.backoffWithJitter(100, 2);
    expect(delay).toBeGreaterThanOrEqual(200);
    expect(delay).toBeLessThan(300);
  });
});
