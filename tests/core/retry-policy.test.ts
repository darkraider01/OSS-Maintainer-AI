import { describe, expect, it, vi } from 'vitest';
import {
  retryWithBackoff,
  isRetryableError,
  DEFAULT_RETRY_POLICY,
} from '../../src/core/resilience/retry-policy.js';

describe('isRetryableError', () => {
  it('treats 429 and 5xx as retryable', () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ status: 500 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
  });

  it('treats 4xx auth/validation errors as non-retryable', () => {
    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError({ status: 401 })).toBe(false);
    expect(isRetryableError({ status: 403 })).toBe(false);
    expect(isRetryableError({ status: 422 })).toBe(false);
  });

  it('treats known transient network error codes as retryable', () => {
    expect(isRetryableError({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryableError({ code: 'ETIMEDOUT' })).toBe(true);
  });

  it('treats a bare fetch network failure (TypeError) as retryable', () => {
    expect(isRetryableError(new TypeError('fetch failed'))).toBe(true);
  });

  it('treats an unrecognized error as non-retryable by default', () => {
    expect(isRetryableError(new Error('something odd'))).toBe(false);
  });
});

describe('retryWithBackoff', () => {
  const fastPolicy = { ...DEFAULT_RETRY_POLICY, baseDelayMs: 1, maxDelayMs: 2 };

  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, fastPolicy);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure and eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue('recovered');

    const result = await retryWithBackoff(fn, fastPolicy);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxAttempts and throws the last error', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 503 });
    await expect(retryWithBackoff(fn, fastPolicy)).rejects.toEqual({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(fastPolicy.maxAttempts);
  });

  it('does not retry a non-retryable error, even on the first attempt', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 401 });
    await expect(retryWithBackoff(fn, fastPolicy)).rejects.toEqual({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
