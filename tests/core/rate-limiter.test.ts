import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../src/core/security/rate-limiter.js';

describe('RateLimiter', () => {
  it('allows requests under the limit', () => {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3 });
    const now = 1_000_000;
    expect(limiter.check('a', now).allowed).toBe(true);
    expect(limiter.check('a', now + 1).allowed).toBe(true);
    expect(limiter.check('a', now + 2).allowed).toBe(true);
  });

  it('blocks once the limit is reached within the window', () => {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 2 });
    const now = 2_000_000;
    expect(limiter.check('a', now).allowed).toBe(true);
    expect(limiter.check('a', now + 1).allowed).toBe(true);
    const blocked = limiter.check('a', now + 2);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('tracks keys independently', () => {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 1 });
    const now = 3_000_000;
    expect(limiter.check('a', now).allowed).toBe(true);
    expect(limiter.check('b', now).allowed).toBe(true);
    expect(limiter.check('a', now).allowed).toBe(false);
  });

  it('allows again once the window slides past the oldest hit', () => {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 1 });
    const now = 4_000_000;
    expect(limiter.check('a', now).allowed).toBe(true);
    expect(limiter.check('a', now + 500).allowed).toBe(false);
    expect(limiter.check('a', now + 1001).allowed).toBe(true);
  });
});
