export interface RetryPolicy {
  /** Total attempts including the first — 3 means "try, retry, retry once more". */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2000,
};

const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
]);

/**
 * Transient failures (network errors, 429, 5xx, timeouts) are retryable.
 * Invalid auth, invalid requests, malformed payloads, and permanent
 * authorization failures (4xx other than 429) are not — retrying those just
 * burns time and quota for a result that will never change.
 */
export function isRetryableError(error: unknown): boolean {
  const err = error as {
    status?: number;
    statusCode?: number;
    code?: string;
    name?: string;
  } | null;
  const status = err?.status ?? err?.statusCode;
  if (typeof status === 'number') {
    return status === 429 || status >= 500;
  }
  if (typeof err?.code === 'string' && RETRYABLE_CODES.has(err.code)) return true;
  // A bare fetch() network failure (DNS, connection refused, etc.) surfaces as TypeError.
  if (error instanceof TypeError) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bounded exponential backoff. Every retry must be idempotent at the call
 * site — this utility doesn't (and can't) guarantee that on its own.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  isRetryable: (error: unknown) => boolean = isRetryableError
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt >= policy.maxAttempts || !isRetryable(error)) throw error;
      const delay = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
      await sleep(delay);
    }
  }
}
