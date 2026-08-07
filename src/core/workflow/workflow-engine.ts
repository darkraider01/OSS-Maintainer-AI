/* eslint-disable no-console */
import type { EventEnvelope, UnifiedEvent } from '../../gateway/adapters/communication-types.js';
import type { AgentRegistry, AgentContext } from '../agent/agent-types.js';
import type { LLMProvider } from '../llm/llm-provider.js';
import type { PromptBuilder } from '../prompt/prompt-builder.js';
import type { OutputAdapters } from './output-adapters.js';
import { logger } from '../../config/logger.js';
import { db } from '../../db/client.js';
import { messages } from '../../db/schema/messages.js';
import { eq, desc } from 'drizzle-orm';

export class WorkflowEngine {
  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly promptBuilder: PromptBuilder,
    private readonly llmProvider: LLMProvider,
    private readonly outputAdapters: OutputAdapters
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

    // 2. Load Memory (recent messages for conversationId)
    log.debug('Loading conversation history from database');
    const recentDbMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, event.conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(10);

    // Map DB messages to chat memory role structure
    const memory = recentDbMessages
      .map((msg: any) => ({
        role: (msg.senderActorId === event.actorId ? 'user' : 'assistant') as 'user' | 'assistant',
        content: msg.content,
      }))
      .reverse();

    // 3. Compile PromptContext using PromptBuilder
    const promptContext = this.promptBuilder.build(
      event,
      event.conversationContext,
      event.repositoryContext,
      memory
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
    };

    // 5. Trigger Agent Execution
    log.info({ agent: agent.name }, 'Invoking agent execute hook');
    const startTime = Date.now();
    const response = await agent.execute(agentContext);
    const executionTime = Date.now() - startTime;

    // 6. Format egress text via OutputAdapters
    const replyText = this.outputAdapters.format(event.provider, response);

    console.log(`\n>>> [Runtime Execution Trace] <<<`);
    console.log(`- Provider:       ${event.provider.toUpperCase()}`);
    console.log(`- Conversation:   ${event.conversationId}`);
    console.log(`- Actor:          ${event.actorId}`);
    console.log(`- Agent:          ${agent.name}`);
    console.log(`- LLM Provider:   ${this.llmProvider.name}`);
    console.log(`- Memory Loaded:  ${memory.length} messages`);
    console.log(`- Execution Time: ${executionTime}ms`);
    console.log(`=================================\n`);

    // 7. Egress Reply
    log.info('Publishing agent response to callback target');
    await envelope.respond(replyText);
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
