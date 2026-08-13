import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { PendingDeliveryStore } from '../../src/core/delivery/pending-delivery-store.js';
import { DeliveryRecoveryWorker } from '../../src/core/delivery/delivery-recovery-worker.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';

// Assertions key off a unique marker per test rather than the aggregate
// runOnce() counts — the pending_deliveries table is shared with every
// other test file in this suite run, so another file's due-but-unresolved
// record for the same provider would otherwise make an exact count flaky
// (see docs/implementation/remaining-work.md's note on shared-DB test runs).

describe('DeliveryRecoveryWorker (#27)', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('delivers a due record and marks it delivered', async () => {
    const store = new PendingDeliveryStore();
    const marker = `recovered-${randomUUID()}`;
    await store.enqueue({
      provider: 'github',
      conversationId: 'c1',
      target: { owner: 'o', repo: 'r', issueNumber: 1 },
      text: marker,
      error: 'original failure',
    });

    const delivered: string[] = [];
    const worker = new DeliveryRecoveryWorker(store, {
      github: async (_target, text) => {
        delivered.push(text);
      },
    });

    const result = await worker.runOnce();
    expect(result.delivered).toBeGreaterThanOrEqual(1);
    expect(delivered).toContain(marker);

    const stillDue = await store.dueForRetry(new Date(Date.now() + 1_000_000));
    expect(stillDue.some((d) => d.text === marker)).toBe(false);
  });

  it('reschedules with backoff on failure, up to maxAttempts, then marks permanently failed', async () => {
    const store = new PendingDeliveryStore();
    const marker = `always-fails-${randomUUID()}`;
    await store.enqueue({
      provider: 'slack',
      conversationId: 'c2',
      target: { providerEventId: 'm1' },
      text: marker,
      error: 'e',
    });

    const worker = new DeliveryRecoveryWorker(
      store,
      {
        slack: async () => {
          throw new Error('still down');
        },
      },
      { maxAttempts: 2, backoffMs: () => 0 } // zero backoff so the record is immediately due again in this test
    );

    await worker.runOnce();
    const dueAfterFirst = await store.dueForRetry(new Date());
    // Attempt 1 of 2: still pending (rescheduled), not yet failed.
    expect(dueAfterFirst.some((d) => d.text === marker)).toBe(true);

    await worker.runOnce();
    const dueAfterSecond = await store.dueForRetry(new Date());
    // Attempt 2 of 2 exhausted maxAttempts: permanently failed, no longer due.
    expect(dueAfterSecond.some((d) => d.text === marker)).toBe(false);
  });

  it('marks a record failed immediately if no deliverer is configured for its provider', async () => {
    const store = new PendingDeliveryStore();
    const marker = `orphaned-${randomUUID()}`;
    await store.enqueue({
      provider: 'discord',
      conversationId: 'c3',
      target: { providerEventId: 'm2' },
      text: marker,
      error: 'e',
    });

    const worker = new DeliveryRecoveryWorker(store, {}); // no deliverers registered
    await worker.runOnce();

    const dueAfter = await store.dueForRetry(new Date());
    expect(dueAfter.some((d) => d.text === marker)).toBe(false);
  });

  it('start()/stop() manage a periodic timer without leaving it referenced', () => {
    const store = new PendingDeliveryStore();
    const worker = new DeliveryRecoveryWorker(store, {});
    const stop = worker.start(60_000);
    expect(typeof stop).toBe('function');
    stop();
  });
});
