export type EscalationReason = 'low_confidence' | 'sensitive_topic' | 'repeated_failure';

export interface EscalationDecision {
  shouldEscalate: boolean;
  reason: EscalationReason | null;
  confidence: number;
  attempts: number;
}

export interface EscalationPolicy {
  /** Below this, a single turn's classification confidence triggers escalation. */
  confidenceThreshold: number;
  /** Consecutive low-confidence/unresolved turns before escalating regardless of this turn's confidence. */
  failureStreakThreshold: number;
}

export const DEFAULT_ESCALATION_POLICY: EscalationPolicy = {
  confidenceThreshold: 0.5,
  failureStreakThreshold: 3,
};
