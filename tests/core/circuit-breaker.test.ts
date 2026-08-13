import { describe, expect, it, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from '../../src/core/resilience/circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('starts CLOSED and stays CLOSED through successes', async () => {
    const breaker = new CircuitBreaker('test', { failureThreshold: 3, cooldownMs: 1000 });
    await breaker.execute(async () => 'ok');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('opens after reaching the failure threshold', async () => {
    const breaker = new CircuitBreaker('test', { failureThreshold: 2, cooldownMs: 1000 });
    const failing = async () => {
      throw new Error('boom');
    };

    await expect(breaker.execute(failing)).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('CLOSED');
    await expect(breaker.execute(failing)).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('OPEN');
  });

  it('fails fast with CircuitBreakerOpenError while OPEN and within cooldown', async () => {
    const breaker = new CircuitBreaker('test', { failureThreshold: 1, cooldownMs: 60_000 });
    await expect(
      breaker.execute(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const fn = vi.fn().mockResolvedValue('should not run');
    await expect(breaker.execute(fn)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('moves to HALF_OPEN after cooldown and closes again on success', async () => {
    const breaker = new CircuitBreaker('test', { failureThreshold: 1, cooldownMs: 1 });
    await expect(
      breaker.execute(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('OPEN');

    await new Promise((resolve) => setTimeout(resolve, 5));

    const result = await breaker.execute(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('reopens immediately if the HALF_OPEN probe also fails', async () => {
    const breaker = new CircuitBreaker('test', { failureThreshold: 1, cooldownMs: 1 });
    await expect(
      breaker.execute(async () => {
        throw new Error('first');
      })
    ).rejects.toThrow('first');

    await new Promise((resolve) => setTimeout(resolve, 5));

    await expect(
      breaker.execute(async () => {
        throw new Error('probe failed too');
      })
    ).rejects.toThrow('probe failed too');
    expect(breaker.getState()).toBe('OPEN');
  });
});
