/* eslint-disable no-console */
import type { EventEnvelope, UnifiedEvent } from '../../gateway/adapters/communication-types.js';
import type { AgentRegistry, AgentContext } from '../agent/agent-types.js';
import type { LLMProvider } from '../llm/llm-provider.js';
import type { PromptBuilder } from '../prompt/prompt-builder.js';
import type { OutputAdapters } from './output-adapters.js';
import { logger } from '../../config/logger.js';
import { db } from '../../db/client.js';
import { messages } from '../../db/schema/messages.js';
import { actorAccounts } from '../../db/schema/actor_accounts.js';
import { actors } from '../../db/schema/actors.js';
import { eq, desc, and, ne, inArray } from 'drizzle-orm';
import { ConversationStateStore } from '../state/conversation-state-store.js';
import {
  DEFAULT_ESCALATION_POLICY,
  type EscalationReason,
} from '../escalation/escalation-types.js';
import type { WorkflowMetadata } from './workflow-types.js';
import { metrics } from '../observability/metrics.js';
import { randomUUID } from 'crypto';
import { ContributorProfileService } from '../contributor/contributor-profile-service.js';
import { IdentityService } from '../../gateway/adapters/identity-service.js';
import type { IIdentityService } from '../../gateway/adapters/communication-types.js';

/**
 * Stable per-provider identity for the agent's own outgoing replies —
 * distinct from GitHub's real bot login (`ensureGitHubBotActor`, used for
 * self-event webhook protection); this one exists purely so replies have
 * an actor to persist against.
 */
const AGENT_PROVIDER_USER_ID = 'oss-maintainer-ai-bot';

export class WorkflowEngine {
  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly promptBuilder: PromptBuilder,
    private readonly llmProvider: LLMProvider,
    private readonly outputAdapters: OutputAdapters,
    private readonly stateStore: ConversationStateStore = new ConversationStateStore(),
    private readonly contributorProfileService: ContributorProfileService = new ContributorProfileService(),
    private readonly identityService: IIdentityService = new IdentityService()
  ) {}

  /**
   * Listen to raw event bus envelopes and route them through agent execution pipeline.
   */
  async handleEvent(envelope: EventEnvelope): Promise<void> {
    const event = envelope.payload;
    const log = logger.child({ eventId: event.id, correlationId: envelope.correlationId });

    log.info('WorkflowEngine routing incoming event');

    // 1. Resolve agent from registry. We default to 'maintainer-agent' for issue triage.
    const agentName = (event.metadata?.agent as string) || 'maintainer-agent';
    const agent = this.agentRegistry.find(agentName);
    if (!agent) {
      log.warn({ agentName }, 'Agent not found in registry; skipping event processing');
      return;
    }

    // 2. Human-escalation gate: once a conversation is escalated, the agent
    // stops replying autonomously until a human clears it (PRD §9 — "prevent
    // the agent from repeatedly responding while the conversation is under
    // human control"). The event is still persisted upstream by
    // CommunicationService; only the auto-reply is suppressed here.
    const conversationState = await this.stateStore.get(event.conversationId);
    if (conversationState.escalatedAt) {
      log.info(
        { escalationReason: conversationState.escalationReason },
        'Conversation is under human control; skipping autonomous agent response'
      );
      return;
    }

    // 3. Load Memory (recent messages for conversationId)
    log.debug('Loading conversation history from database');
    const recentDbMessages = await db
      .select({
        content: messages.content,
        senderActorId: messages.senderActorId,
        actorType: actors.type,
      })
      .from(messages)
      .innerJoin(actors, eq(messages.senderActorId, actors.id))
      .where(eq(messages.conversationId, event.conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(10);

    // Map DB messages to chat memory role structure
    const memory = recentDbMessages
      .map((msg: any) => ({
        role: (msg.actorType === 'agent' || msg.actorType === 'bot' ? 'assistant' : 'user') as
          'user' | 'assistant',
        content: msg.content,
      }))
      .reverse();

    // 3. Resolve Actor account names and connected profiles
    const associatedAccounts = await db
      .select()
      .from(actorAccounts)
      .where(eq(actorAccounts.actorId, event.actorId));

    const actorName =
      associatedAccounts.find((acc: any) => acc.provider === event.provider)?.username ||
      associatedAccounts[0]?.username ||
      null;

    // 4. Load cross-channel context from other conversations this actor participated in
    const otherConversations = await db
      .selectDistinct({ id: messages.conversationId })
      .from(messages)
      .where(
        and(
          eq(messages.senderActorId, event.actorId),
          ne(messages.conversationId, event.conversationId)
        )
      )
      .limit(3);

    let crossChannelHistory: Array<{
      role: 'user' | 'assistant';
      content: string;
      conversationId: string;
    }> = [];
    if (otherConversations.length > 0) {
      const convIds = otherConversations.map((c: any) => c.id);
      const otherMessages = await db
        .select({
          content: messages.content,
          senderActorId: messages.senderActorId,
          actorType: actors.type,
          conversationId: messages.conversationId,
        })
        .from(messages)
        .innerJoin(actors, eq(messages.senderActorId, actors.id))
        .where(inArray(messages.conversationId, convIds))
        .orderBy(desc(messages.createdAt))
        .limit(10);

      crossChannelHistory = otherMessages
        .map((msg: any) => ({
          role: (msg.actorType === 'agent' || msg.actorType === 'bot' ? 'assistant' : 'user') as
            'user' | 'assistant',
          content: msg.content,
          conversationId: msg.conversationId,
        }))
        .reverse();
    }

    // 4b. Contributor profile — factual aggregation (connected accounts,
    // message count, onboarding state), not a score (PRD §15).
    const contributorProfile = await this.contributorProfileService.build(event.actorId);

    // 5. Compile PromptContext using PromptBuilder
    const promptContext = this.promptBuilder.build(
      event,
      event.conversationContext,
      event.repositoryContext,
      memory,
      actorName,
      associatedAccounts.map((acc: any) => ({ provider: acc.provider, username: acc.username })),
      crossChannelHistory,
      contributorProfile
    );

    // 4. Construct AgentContext
    const agentContext: AgentContext = {
      event,
      conversationContext: event.conversationContext,
      repositoryContext: event.repositoryContext,
      memory,
      promptContext,
      llm: this.llmProvider,
      logger: log,
      config: {},
      tools: [],
      escalation: { failureStreak: conversationState.failureStreak },
      triageState: conversationState.triageState,
    };

    // 5. Trigger Agent Execution. LLM/GitHub calls already degrade gracefully
    // internally (retry, then fall back to a text response) — this catch is
    // the last line of defense for anything else that throws (a DB error, a
    // bug in a workflow), so an event never gets silently dropped with zero
    // reply (PRD §10: "do not crash runtime... notify user appropriately").
    log.info({ agent: agent.name }, 'Invoking agent execute hook');
    const executionId = randomUUID();
    const startTime = Date.now();
    let response: Awaited<ReturnType<typeof agent.execute>>;
    let executionFailed = false;
    try {
      response = await agent.execute(agentContext);
    } catch (error) {
      executionFailed = true;
      log.error(
        { err: error },
        'Agent execution failed unexpectedly; degrading to a fallback reply'
      );
      response = {
        text: "Something went wrong processing this on my end. I've recorded it and a maintainer will follow up.",
        confidence: 0,
        actions: [],
        artifacts: [],
        metadata: { agent: agent.name, executionError: true },
      };
    }
    const executionTime = Date.now() - startTime;
    const workflowMetadata = response.metadata as WorkflowMetadata | undefined;
    const workflowName =
      (response.metadata as { workflow?: string } | undefined)?.workflow ?? 'unknown';
    const status = executionFailed
      ? 'error'
      : workflowMetadata?.escalated
        ? 'escalated'
        : 'success';

    metrics.agentExecutionsTotal.inc({ workflow: workflowName });
    metrics.agentExecutionDuration.observeSeconds(executionTime / 1000, { workflow: workflowName });
    (executionFailed ? metrics.eventsFailedTotal : metrics.eventsProcessedTotal).inc({
      provider: event.provider,
    });

    // Single structured line carrying the full field set an observability
    // backend needs to reconstruct this execution (PRD §10) — everything
    // else in this method logs its own narrower step.
    log.info(
      {
        correlationId: envelope.correlationId,
        causationId: envelope.causationId,
        eventId: event.id,
        provider: event.provider,
        conversationId: event.conversationId,
        actorId: event.actorId,
        executionId,
        workflow: workflowName,
        durationMs: executionTime,
        status,
      },
      'Agent execution completed'
    );

    // 5b. Persist workflow-state side effects the agent reported via metadata.
    // Workflows stay pure over AgentContext; this is the one place DB writes
    // for escalation/triage state happen.
    if (workflowMetadata?.escalated && workflowMetadata.escalationReason) {
      metrics.escalationsTotal.inc({ reason: workflowMetadata.escalationReason });
      await this.stateStore.escalate(
        event.conversationId,
        workflowMetadata.escalationReason as EscalationReason
      );
    } else {
      await this.stateStore.recordOutcome(
        event.conversationId,
        response.confidence,
        DEFAULT_ESCALATION_POLICY.confidenceThreshold
      );
    }
    if (workflowMetadata && 'triageStateUpdate' in workflowMetadata) {
      await this.stateStore.saveTriageState(
        event.conversationId,
        workflowMetadata.triageStateUpdate ?? null
      );
    }
    if (!executionFailed && workflowName === 'onboarding-workflow') {
      await this.contributorProfileService.recordOnboarded(event.actorId);
    }

    // 6. Format egress text via OutputAdapters
    const replyText = this.outputAdapters.format(event.provider, response);

    // Demo-mode trace only — console I/O here is expensive enough at volume
    // to skew load-test measurements, so the harness (src/cli/load-test.ts)
    // opts out via this flag. The structured `log.info` above carries the
    // same information for real observability tooling.
    if (process.env.LOAD_TEST_QUIET !== 'true') {
      console.log(`\n>>> [Runtime Execution Trace] <<<`);
      console.log(`- Provider:       ${event.provider.toUpperCase()}`);
      console.log(`- Conversation:   ${event.conversationId}`);
      console.log(`- Actor:          ${event.actorId}`);
      console.log(`- Agent:          ${agent.name}`);
      console.log(`- LLM Provider:   ${this.llmProvider.name}`);
      console.log(`- Memory Loaded:  ${memory.length} messages`);
      console.log(`- Execution Time: ${executionTime}ms`);
      console.log(`=================================\n`);
    }

    // 7. Egress Reply
    log.info('Publishing agent response to callback target');
    await envelope.respond(replyText);

    // 8. Persist the agent's own reply so future turns' memory and
    // cross-channel history include what the bot actually said, not just
    // what the human asked (previously only the inbound message was ever
    // written to `messages`). Deliberately after — and isolated from —
    // the reply itself: sending the answer must never depend on this
    // side effect succeeding.
    try {
      const agentActorId = await this.identityService.resolveActor(
        {
          provider: event.provider,
          providerUserId: AGENT_PROVIDER_USER_ID,
          username: 'OSS-Maintainer-AI',
          displayName: 'OSS-Maintainer-AI',
        },
        envelope.correlationId
      );
      await db
        .update(actors)
        .set({ type: 'agent' })
        .where(and(eq(actors.id, agentActorId), ne(actors.type, 'agent')));
      await db.insert(messages).values({
        id: randomUUID(),
        conversationId: event.conversationId,
        senderActorId: agentActorId,
        content: replyText,
        createdAt: new Date(),
      });
    } catch (error) {
      log.error(
        { err: error },
        'Failed to persist agent reply; memory for this turn will be incomplete'
      );
    }
  }

  /**
   * Replays a previously persisted UnifiedEvent from the database.
   */
  async replay(
    eventPayload: UnifiedEvent,
    correlationId: string,
    respondCb: (text: string) => Promise<void>
  ): Promise<void> {
    const log = logger.child({ eventId: eventPayload.id, correlationId });
    log.info('Replaying event workflow pipeline');

    const envelope: EventEnvelope = {
      eventId: eventPayload.id,
      eventType: eventPayload.eventType,
      provider: eventPayload.provider,
      version: 1,
      occurredAt: eventPayload.occurredAt,
      correlationId,
      causationId: eventPayload.id,
      payload: eventPayload,
      respond: respondCb,
    };

    await this.handleEvent(envelope);
  }
}
