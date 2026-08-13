export interface IssueAnalyticsSummary {
  sinceISODate: string;
  totalConversations: number;
  escalatedConversations: number;
  /** 0..1 — same value as humanHandoffRate; PRD lists both names, they're the same ratio. */
  escalationRate: number;
  humanHandoffRate: number;
  escalationReasonBreakdown: Record<string, number>;
  /** Conversations with in-flight (not yet completed) Issue Triage state right now. */
  conversationsWithOpenTriage: number;
  /** Average time from a contributor's first message to the agent's first reply, across conversations with both. Null if no data. */
  averageTimeToFirstResponseMs: number | null;
}
