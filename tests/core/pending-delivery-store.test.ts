import { beforeAll, describe, expect, it } from 'vitest';
import { PendingDeliveryStore } from '../../src/core/delivery/pending-delivery-store.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';

describe('PendingDeliveryStore (#27)', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('enqueues a delivery and surfaces it as due immediately', async () => {
    const store = new PendingDeliveryStore();
    await store.enqueue({
      provider: 'github',
      conversationId: 'c1',
      target: { owner: 'o', repo: 'r', issueNumber: 1 },
      text: 'hello',
      error: 'boom',
    });

    const due = await store.dueForRetry(new Date());
    const record = due.find((d) => d.text === 'hello' && d.provider === 'github');
    expect(record).toBeDefined();

    // Resolve it so this record doesn't leak into other tests/files sharing the DB.
    await store.markDelivered(record!.id);
  });

  it('marking delivered removes it from the due set', async () => {
    const store = new PendingDeliveryStore();
    await store.enqueue({
      provider: 'slack',
      conversationId: 'c2',
      target: { providerEventId: 'm1' },
      text: 'to deliver',
      error: 'e',
    });

    const [record] = (await store.dueForRetry(new Date())).filter((d) => d.text === 'to deliver');
    await store.markDelivered(record.id);

    const stillDue = await store.dueForRetry(new Date());
    expect(stillDue.some((d) => d.id === record.id)).toBe(false);
  });

  it('rescheduling with markRetried moves nextAttemptAt into the future, so it is not immediately due', async () => {
    const store = new PendingDeliveryStore();
    await store.enqueue({
      provider: 'discord',
      conversationId: 'c3',
      target: { providerEventId: 'm2' },
      text: 'retry me',
      error: 'e',
    });
    const [record] = (await store.dueForRetry(new Date())).filter((d) => d.text === 'retry me');

    const future = new Date(Date.now() + 60_000);
    await store.markRetried(record.id, record.attempts + 1, future, 'still failing');

    const dueNow = await store.dueForRetry(new Date());
    expect(dueNow.some((d) => d.id === record.id)).toBe(false);

    const dueAfterBackoff = await store.dueForRetry(new Date(future.getTime() + 1));
    expect(dueAfterBackoff.some((d) => d.id === record.id)).toBe(true);
  });

  it('marking failed removes it from the due set permanently', async () => {
    const store = new PendingDeliveryStore();
    await store.enqueue({
      provider: 'github',
      conversationId: 'c4',
      target: { owner: 'o', repo: 'r', issueNumber: 2 },
      text: 'give up',
      error: 'e',
    });
    const [record] = (await store.dueForRetry(new Date())).filter((d) => d.text === 'give up');
    await store.markFailed(record.id, 'permanent error');

    const dueFarFuture = await store.dueForRetry(new Date(Date.now() + 1_000_000_000));
    expect(dueFarFuture.some((d) => d.id === record.id)).toBe(false);
  });
});
