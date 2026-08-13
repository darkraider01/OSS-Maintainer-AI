import type { Agent, AgentContext, AgentResponse } from './agent-types.js';
import type { IntentClassifier } from '../intent/intent-types.js';
import { RuleBasedIntentClassifier } from '../intent/intent-classifier.js';
import { EscalationService } from '../escalation/escalation-service.js';
import type { WorkflowRouter } from '../workflow/workflow-router.js';

/**
 * Single agent, routed internally (PRD §18: no IssueTriageAgent /
 * OnboardingAgent / EscalationAgent). Classifies intent, checks the
 * cross-cutting escalation policy, then delegates to whichever Workflow
 * WorkflowRouter picks. All DB persistence (escalation flag, failure streak,
 * triage state) happens in WorkflowEngine, driven by AgentResponse.metadata
 * — this class and the workflows it calls stay pure over AgentContext.
 */
export class MaintainerAgent implements Agent {
  readonly name = 'maintainer-agent';
  readonly description = 'Triage issues, answer comments, and manage repository discussions';
  readonly systemInstructions = 'You are the Lead OSS Maintainer. Triage and reply professionally.';

  constructor(
    private readonly workflowRouter: WorkflowRouter,
    private readonly intentClassifier: IntentClassifier = new RuleBasedIntentClassifier(),
    private readonly escalationService: EscalationService = new EscalationService()
  ) {}

  async execute(context: AgentContext): Promise<AgentResponse> {
    const { event, logger } = context;
    logger.info({ eventId: event.id }, 'MaintainerAgent starting execution');

    let classification = await this.intentClassifier.classify(event.text);

    // Structural trigger, not text classification: a freshly-opened PR gets
    // summarized automatically (PRD §14 "Open a PR -> receive useful PR
    // analysis"), unless the description itself reads as a sensitive-topic
    // escalation — that still wins over a routine summary.
    const github = event.metadata?.github as { kind?: string; action?: string } | undefined;
    if (
      github?.kind === 'pull_request' &&
      github?.action === 'opened' &&
      classification.intent !== 'escalation_signal'
    ) {
      classification = {
        intent: 'pr_summary_request',
        confidence: 0.9,
        signals: ['pull_request_opened'],
      };
    }

    logger.debug(
      {
        intent: classification.intent,
        confidence: classification.confidence,
        signals: classification.signals,
      },
      'Intent classified'
    );

    const decision = this.escalationService.evaluate({
      intent: classification.intent,
      confidence: classification.confidence,
      failureStreak: context.escalation.failureStreak,
    });

    let response: AgentResponse;
    let workflowName: string;
    if (decision.shouldEscalate) {
      const workflow = this.workflowRouter.escalationWorkflow;
      workflowName = workflow.name;
      response = await workflow.execute(context, classification, decision);
    } else {
      const workflow = this.workflowRouter.route(classification.intent);
      workflowName = workflow.name;
      response = await workflow.execute(context, classification);
    }

    return {
      ...response,
      metadata: {
        agent: this.name,
        intent: classification.intent,
        intentConfidence: classification.confidence,
        workflow: workflowName,
        ...response.metadata,
      },
    };
  }
}
