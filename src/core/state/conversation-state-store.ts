import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations } from '../../db/schema/conversations.js';
import type { EscalationReason } from '../escalation/escalation-types.js';
import type { IssueTriageState } from '../triage/issue-triage-types.js';

export interface ConversationState {
  escalatedAt: string | null;
  escalationReason: EscalationReason | null;
  failureStreak: number;
  triageState: IssueTriageState | null;
}

/**
 * Centralizes the per-conversation workflow state (escalation flag, failure
 * streak, in-flight triage fields) added to the `conversations` table.
 * WorkflowEngine is the only caller — workflows themselves stay pure
 * functions over AgentContext and return state changes via
 * AgentResponse.metadata, which WorkflowEngine persists through here.
 */
export class ConversationStateStore {
  async get(conversationId: string): Promise<ConversationState> {
    const [row] = await db
      .select({
        escalatedAt: conversations.escalatedAt,
        escalationReason: conversations.escalationReason,
        failureStreak: conversations.failureStreak,
        triageState: conversations.triageState,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    if (!row) {
      return { escalatedAt: null, escalationReason: null, failureStreak: 0, triageState: null };
    }

    return {
      escalatedAt: row.escalatedAt ? new Date(row.escalatedAt).toISOString() : null,
      escalationReason: (row.escalationReason as EscalationReason | null) ?? null,
      failureStreak: row.failureStreak ?? 0,
      triageState: (row.triageState as IssueTriageState | null) ?? null,
    };
  }

  async escalate(conversationId: string, reason: EscalationReason): Promise<void> {
    await db
      .update(conversations)
      .set({ escalatedAt: new Date(), escalationReason: reason, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }

  /** Updates the failure streak based on this turn's response confidence. Returns the new streak. */
  async recordOutcome(
    conversationId: string,
    confidence: number,
    confidenceThreshold: number
  ): Promise<number> {
    const current = await this.get(conversationId);
    const nextStreak = confidence < confidenceThreshold ? current.failureStreak + 1 : 0;
    await db
      .update(conversations)
      .set({ failureStreak: nextStreak, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
    return nextStreak;
  }

  async saveTriageState(conversationId: string, state: IssueTriageState | null): Promise<void> {
    await db
      .update(conversations)
      .set({ triageState: state, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }
}
