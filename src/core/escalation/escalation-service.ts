import type { Intent } from '../intent/intent-types.js';
import {
  DEFAULT_ESCALATION_POLICY,
  type EscalationDecision,
  type EscalationPolicy,
} from './escalation-types.js';

export interface EscalationEvaluationInput {
  intent: Intent;
  /** The current turn's intent-classification confidence. */
  confidence: number;
  /** Consecutive prior low-confidence/unresolved turns for this conversation. */
  failureStreak: number;
}

/**
 * Pure decision function per PRD §9 — no DB/IO here. Trigger order:
 * sensitive topic (hard override, `escalation_signal` intent) > repeated
 * failure > low confidence on this turn.
 */
export class EscalationService {
  constructor(readonly policy: EscalationPolicy = DEFAULT_ESCALATION_POLICY) {}

  evaluate(input: EscalationEvaluationInput): EscalationDecision {
    if (input.intent === 'escalation_signal') {
      return {
        shouldEscalate: true,
        reason: 'sensitive_topic',
        confidence: input.confidence,
        attempts: input.failureStreak,
      };
    }

    if (input.failureStreak >= this.policy.failureStreakThreshold) {
      return {
        shouldEscalate: true,
        reason: 'repeated_failure',
        confidence: input.confidence,
        attempts: input.failureStreak,
      };
    }

    if (input.confidence < this.policy.confidenceThreshold) {
      return {
        shouldEscalate: true,
        reason: 'low_confidence',
        confidence: input.confidence,
        attempts: input.failureStreak,
      };
    }

    return {
      shouldEscalate: false,
      reason: null,
      confidence: input.confidence,
      attempts: input.failureStreak,
    };
  }
}
