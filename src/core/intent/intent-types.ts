/**
 * Intents the WorkflowRouter can dispatch on. `escalation_signal` is not a
 * "normal" conversation topic — it's a hard override detected by keyword
 * policy (see intent-classifier.ts) that always routes to EscalationWorkflow
 * regardless of confidence.
 */
export type Intent =
  | 'bug_report'
  | 'contribution_question'
  | 'escalation_signal'
  | 'pr_summary_request'
  | 'general_qa';

export interface IntentClassificationResult {
  intent: Intent;
  /** 0..1. Reflects how unambiguous the classification is, not response quality. */
  confidence: number;
  /** Matched keyword signals, kept for logging/debugging/tests — not user-facing. */
  signals: string[];
}

export interface IntentClassifier {
  classify(text: string | null): Promise<IntentClassificationResult>;
}
