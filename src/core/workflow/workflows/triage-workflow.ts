import type { AgentContext, AgentResponse } from '../../agent/agent-types.js';
import type { IntentClassificationResult } from '../../intent/intent-types.js';
import type { Workflow, WorkflowMetadata } from '../workflow-types.js';
import { IssueTriageService } from '../../triage/issue-triage-service.js';

/**
 * Issue Triage (#18): multi-turn missing-field collection. Never creates a
 * GitHub issue itself — per PRD §7/§21 it only proposes one once complete,
 * gated on a maintainer confirming ("prefer confirmation before external
 * side effects").
 */
export class TriageWorkflow implements Workflow {
  readonly name = 'triage-workflow';
  private readonly service = new IssueTriageService();

  async execute(
    context: AgentContext,
    classification: IntentClassificationResult
  ): Promise<AgentResponse> {
    const result = this.service.process({
      conversationId: context.event.conversationId,
      messageText: context.event.text ?? '',
      priorState: context.triageState,
    });

    const metadata: WorkflowMetadata & Record<string, unknown> = {
      // Clear persisted state once the issue is ready — a later message
      // starting a new bug report shouldn't inherit stale fields.
      triageStateUpdate: result.isComplete ? null : result.state,
      isComplete: result.isComplete,
      missingFields: result.missingFields,
      collectedFields: result.state.collectedFields,
    };

    return {
      text: result.responseText,
      confidence: classification.confidence,
      actions: result.isComplete
        ? [{ tool: 'propose_github_issue', args: { fields: result.state.collectedFields } }]
        : [],
      artifacts: [],
      metadata,
    };
  }
}
