export interface RateLimitPolicy {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the caller can retry — 0 when allowed. */
  retryAfterMs: number;
}

/**
 * Provider-independent sliding-window limiter, keyed by an arbitrary string
 * (per-IP, per-provider, per-actor, per-conversation — the caller decides
 * what the key means). In-process only, same bounded-Map-with-eviction style
 * as DeduplicationService — no shared/distributed state for the MVP.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly maxTrackedKeys = 10_000;

  constructor(private readonly policy: RateLimitPolicy) {}

  check(key: string, now: number = Date.now()): RateLimitResult {
    const windowStart = now - this.policy.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > windowStart);

    if (timestamps.length >= this.policy.maxRequests) {
      this.hits.set(key, timestamps);
      const retryAfterMs = Math.max(0, timestamps[0] + this.policy.windowMs - now);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);

    if (this.hits.size > this.maxTrackedKeys) {
      const oldestKey = this.hits.keys().next().value;
      if (oldestKey !== undefined) this.hits.delete(oldestKey);
    }

    return {
      allowed: true,
      remaining: this.policy.maxRequests - timestamps.length,
      retryAfterMs: 0,
    };
  }
}
