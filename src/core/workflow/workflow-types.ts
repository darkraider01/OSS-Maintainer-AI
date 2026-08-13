import type { AgentContext, AgentResponse } from '../agent/agent-types.js';
import type { IntentClassificationResult } from '../intent/intent-types.js';
import type { EscalationDecision } from '../escalation/escalation-types.js';
import type { IssueTriageState } from '../triage/issue-triage-types.js';

/** Keys WorkflowEngine reads off AgentResponse.metadata to persist per-conversation state. */
export interface WorkflowMetadata {
  escalated?: boolean;
  escalationReason?: string;
  /** Present (possibly null, meaning "clear it") whenever triage state changed this turn. */
  triageStateUpdate?: IssueTriageState | null;
}

/**
 * One workflow = one route through the shared MaintainerAgent (PRD §18: no
 * IssueTriageAgent/OnboardingAgent/EscalationAgent classes). Pure over its
 * inputs — no direct DB access — so WorkflowEngine stays the single place
 * that persists conversation state.
 */
export interface Workflow {
  name: string;
  execute(
    context: AgentContext,
    classification: IntentClassificationResult
  ): Promise<AgentResponse>;
}

export interface EscalationWorkflow {
  name: string;
  execute(
    context: AgentContext,
    classification: IntentClassificationResult,
    decision: EscalationDecision
  ): Promise<AgentResponse>;
}
