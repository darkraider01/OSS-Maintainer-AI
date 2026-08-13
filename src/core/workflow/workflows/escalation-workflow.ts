import { logger } from '../../../config/logger.js';
import type { AgentContext, AgentResponse } from '../../agent/agent-types.js';
import type { IntentClassificationResult } from '../../intent/intent-types.js';
import type { EscalationDecision, EscalationReason } from '../../escalation/escalation-types.js';
import type {
  EscalationWorkflow as EscalationWorkflowInterface,
  WorkflowMetadata,
} from '../workflow-types.js';
import {
  buildMaintainerMention,
  type MaintainerMentionConfig,
} from '../../escalation/maintainer-mention.js';

const REASON_EXPLANATIONS: Record<EscalationReason, string> = {
  sensitive_topic: 'this touches a sensitive topic that needs a maintainer’s judgment',
  repeated_failure: "I haven't been able to resolve this after several attempts",
  low_confidence: "I'm not confident I understood this correctly",
};

/**
 * Human Escalation (#20). Stops autonomous handling and hands the
 * conversation to a maintainer. When `mentionConfig` has an entry for the
 * event's provider, the reply @-mentions that person — a real notification
 * delivered through the platform's own mention system via the same egress
 * path the reply already goes out on (see maintainer-mention.ts for why
 * that's the mechanism instead of a separate paging integration). With
 * nothing configured, this stays a structured log line, same as before.
 */
export class DefaultEscalationWorkflow implements EscalationWorkflowInterface {
  readonly name = 'escalation-workflow';

  constructor(private readonly mentionConfig: MaintainerMentionConfig = {}) {}

  async execute(
    context: AgentContext,
    _classification: IntentClassificationResult,
    decision: EscalationDecision
  ): Promise<AgentResponse> {
    const reason = decision.reason ?? 'low_confidence';
    const mention = buildMaintainerMention(context.event.provider, this.mentionConfig);

    logger.warn(
      {
        conversationId: context.event.conversationId,
        actorId: context.event.actorId,
        provider: context.event.provider,
        escalationReason: reason,
        confidence: decision.confidence,
        attempts: decision.attempts,
        maintainerNotified: Boolean(mention),
      },
      'Conversation escalated to a human maintainer'
    );

    const text = [
      `I'm looping in a maintainer here${mention ? ` (${mention})` : ''} — ${REASON_EXPLANATIONS[reason]}.`,
      'A human will follow up on this thread. I’ll hold off on responding further until then.',
    ].join('\n');

    const metadata: WorkflowMetadata & Record<string, unknown> = {
      escalated: true,
      escalationReason: reason,
      attempts: decision.attempts,
      maintainerNotified: Boolean(mention),
    };

    return {
      text,
      confidence: decision.confidence,
      actions: [
        {
          tool: 'notify_maintainer',
          args: { reason, conversationId: context.event.conversationId, mentioned: mention },
        },
      ],
      artifacts: [],
      metadata,
    };
  }
}
