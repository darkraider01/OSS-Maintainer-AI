import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { db } from '../../src/db/client.js';
import { conversations } from '../../src/db/schema/conversations.js';
import { actors } from '../../src/db/schema/actors.js';
import { messages } from '../../src/db/schema/messages.js';
import { IssueAnalyticsService } from '../../src/core/analytics/issue-analytics-service.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';

async function seedActor(type: 'human' | 'agent') {
  const id = randomUUID();
  await db.insert(actors).values({ id, type, createdAt: new Date(), updatedAt: new Date() });
  return id;
}

describe('IssueAnalyticsService (#24)', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('counts total conversations and escalation rate within the window', async () => {
    const since = new Date(Date.now() - 1000).toISOString();

    await db.insert(conversations).values({
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      escalatedAt: new Date(),
      escalationReason: 'sensitive_topic',
    });
    await db.insert(conversations).values({
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = new IssueAnalyticsService();
    const summary = await service.summarize(since);

    expect(summary.totalConversations).toBeGreaterThanOrEqual(2);
    expect(summary.escalatedConversations).toBeGreaterThanOrEqual(1);
    expect(summary.escalationRate).toBeGreaterThan(0);
    expect(summary.escalationRate).toBeLessThanOrEqual(1);
    expect(summary.humanHandoffRate).toBe(summary.escalationRate);
    expect(summary.escalationReasonBreakdown.sensitive_topic).toBeGreaterThanOrEqual(1);
  });

  it('counts conversations with in-flight triage state', async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    await db.insert(conversations).values({
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      triageState: { collectedFields: {}, turnCount: 1, updatedAt: new Date().toISOString() },
    });

    const service = new IssueAnalyticsService();
    const summary = await service.summarize(since);
    expect(summary.conversationsWithOpenTriage).toBeGreaterThanOrEqual(1);
  });

  it('computes average time-to-first-response from human message to agent reply', async () => {
    const humanId = await seedActor('human');
    const agentId = await seedActor('agent');
    const conversationId = randomUUID();
    const since = new Date(Date.now() - 60_000).toISOString();

    await db
      .insert(conversations)
      .values({ id: conversationId, createdAt: new Date(), updatedAt: new Date() });

    const humanAt = new Date();
    const agentAt = new Date(humanAt.getTime() + 5000);
    await db.insert(messages).values({
      id: randomUUID(),
      conversationId,
      senderActorId: humanId,
      content: 'help',
      createdAt: humanAt,
    });
    await db.insert(messages).values({
      id: randomUUID(),
      conversationId,
      senderActorId: agentId,
      content: 'sure',
      createdAt: agentAt,
    });

    const service = new IssueAnalyticsService();
    const summary = await service.summarize(since);
    expect(summary.averageTimeToFirstResponseMs).not.toBeNull();
    expect(summary.averageTimeToFirstResponseMs).toBeGreaterThan(0);
  });

  it('returns null average response time when there is no data', async () => {
    const futureDate = new Date(Date.now() + 10_000_000).toISOString();
    const service = new IssueAnalyticsService();
    const summary = await service.summarize(futureDate);
    expect(summary.totalConversations).toBe(0);
    expect(summary.averageTimeToFirstResponseMs).toBeNull();
    expect(summary.escalationRate).toBe(0);
  });
});
