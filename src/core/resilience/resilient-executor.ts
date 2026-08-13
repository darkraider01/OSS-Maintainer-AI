import { CircuitBreaker, DEFAULT_CIRCUIT_BREAKER_OPTIONS } from './circuit-breaker.js';
import type { CircuitBreakerOptions, CircuitState } from './circuit-breaker.js';
import { DEFAULT_RETRY_POLICY, isRetryableError, retryWithBackoff } from './retry-policy.js';
import type { RetryPolicy } from './retry-policy.js';

/**
 * One resilience wrapper per external dependency (LLM provider, GitHub API,
 * Caspian). Retries transient failures with backoff inside the breaker, so a
 * string of failures trips the breaker rather than retrying forever against
 * a provider that's fully down.
 */
export class ResilientExecutor {
  private readonly breaker: CircuitBreaker;

  constructor(
    readonly name: string,
    private readonly retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
    breakerOptions: CircuitBreakerOptions = DEFAULT_CIRCUIT_BREAKER_OPTIONS
  ) {
    this.breaker = new CircuitBreaker(name, breakerOptions);
  }

  execute<T>(
    fn: () => Promise<T>,
    isRetryable: (error: unknown) => boolean = isRetryableError
  ): Promise<T> {
    return this.breaker.execute(() => retryWithBackoff(fn, this.retryPolicy, isRetryable));
  }

  getState(): CircuitState {
    return this.breaker.getState();
  }
}
