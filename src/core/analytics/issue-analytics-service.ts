import { asc, eq, gte, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations } from '../../db/schema/conversations.js';
import { messages } from '../../db/schema/messages.js';
import { actors } from '../../db/schema/actors.js';
import type { IssueAnalyticsSummary } from './issue-analytics-types.js';

/**
 * Issue Analytics (#24, nice-to-have). Queries the existing
 * conversations/messages/actors tables directly — no second analytics
 * database (PRD §17). Deliberately scoped to what's actually persisted and
 * reliable:
 *
 * - `duplicate_events` is intentionally NOT reimplemented here.
 *   `DeduplicationService` is in-memory only (never written to the DB), so
 *   a DB-driven query can't answer it historically — that number already
 *   lives in Phase 7's `deduplicated_events_total` Prometheus counter
 *   (`GET /metrics`), which is the correct source for it.
 * - `issues_resolved` / `average_resolution_time` are NOT computed either:
 *   nothing in the schema marks a conversation "resolved" (no closedAt
 *   column), and inventing a heuristic for it would be exactly the kind of
 *   unsupported claim the rest of this codebase has been careful to avoid
 *   (see docs/performance/load-test-report.md for the same principle
 *   applied to availability claims).
 */
export class IssueAnalyticsService {
  async summarize(sinceISODate: string): Promise<IssueAnalyticsSummary> {
    const since = new Date(sinceISODate);
    const rows = await db.select().from(conversations).where(gte(conversations.createdAt, since));

    const total = rows.length;
    const escalated = rows.filter((r: any) => r.escalatedAt !== null);
    const openTriage = rows.filter((r: any) => r.triageState !== null);

    const escalationReasonBreakdown: Record<string, number> = {};
    for (const row of escalated) {
      const reason = (row as any).escalationReason ?? 'unknown';
      escalationReasonBreakdown[reason] = (escalationReasonBreakdown[reason] ?? 0) + 1;
    }

    const conversationIds = rows.map((r: any) => r.id as string);
    const averageTimeToFirstResponseMs =
      await this.computeAverageFirstResponseTime(conversationIds);

    const escalationRate = total > 0 ? escalated.length / total : 0;

    return {
      sinceISODate,
      totalConversations: total,
      escalatedConversations: escalated.length,
      escalationRate,
      humanHandoffRate: escalationRate,
      escalationReasonBreakdown,
      conversationsWithOpenTriage: openTriage.length,
      averageTimeToFirstResponseMs,
    };
  }

  /** Contributor's first message -> agent's first reply after it, averaged across conversations that have both. */
  private async computeAverageFirstResponseTime(conversationIds: string[]): Promise<number | null> {
    if (conversationIds.length === 0) return null;

    const rows = await db
      .select({
        conversationId: messages.conversationId,
        createdAt: messages.createdAt,
        actorType: actors.type,
      })
      .from(messages)
      .innerJoin(actors, eq(messages.senderActorId, actors.id))
      .where(inArray(messages.conversationId, conversationIds))
      .orderBy(asc(messages.createdAt));

    const firstHumanMessageAt = new Map<string, Date>();
    const responseDeltasMs: number[] = [];

    for (const row of rows as any[]) {
      const isAgent = row.actorType === 'agent' || row.actorType === 'bot';
      if (!isAgent) {
        if (!firstHumanMessageAt.has(row.conversationId)) {
          firstHumanMessageAt.set(row.conversationId, row.createdAt);
        }
        continue;
      }
      const humanAt = firstHumanMessageAt.get(row.conversationId);
      if (humanAt) {
        responseDeltasMs.push(row.createdAt.getTime() - humanAt.getTime());
        firstHumanMessageAt.delete(row.conversationId); // only count the first reply
      }
    }

    if (responseDeltasMs.length === 0) return null;
    return responseDeltasMs.reduce((sum, ms) => sum + ms, 0) / responseDeltasMs.length;
  }
}
