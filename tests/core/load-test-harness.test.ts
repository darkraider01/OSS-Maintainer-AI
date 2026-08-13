import { beforeAll, describe, expect, it } from 'vitest';
import { runScenario } from '../../src/cli/load-test.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';

describe('load-test harness (#28)', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('runs a small scenario end to end and reports sane numbers', async () => {
    const result = await runScenario({
      name: 'unit-test-smoke',
      repositories: 1,
      conversations: 10,
      concurrency: 5,
      messagesPerConversation: 1,
      channel: 'slack',
      textStyle: 'general',
    });

    expect(result.totalEvents).toBe(10);
    expect(result.successCount).toBe(10);
    expect(result.errorCount).toBe(0);
    expect(result.p50Ms).toBeGreaterThan(0);
    expect(result.p95Ms).toBeGreaterThanOrEqual(result.p50Ms);
    expect(result.throughputPerSec).toBeGreaterThan(0);
  });

  it('distributes conversations across the configured repository count', async () => {
    const result = await runScenario({
      name: 'unit-test-repos',
      repositories: 5,
      conversations: 15,
      concurrency: 5,
      messagesPerConversation: 1,
      channel: 'github',
      textStyle: 'general',
    });

    expect(result.successCount).toBe(15);
    expect(result.errorCount).toBe(0);
  });
});
