import type { Agent, AgentContext, AgentResponse } from './agent-types.js';

export class MaintainerAgent implements Agent {
  readonly name = 'maintainer-agent';
  readonly description = 'Triage issues, answer comments, and manage repository discussions';
  readonly systemInstructions = 'You are the Lead OSS Maintainer. Triage and reply professionally.';

  async execute(context: AgentContext): Promise<AgentResponse> {
    const { event, promptContext, llm, logger } = context;
    logger.info({ eventId: event.id }, 'MaintainerAgent starting execution');

    // Invoke LLM
    const llmRes = await llm.generate(
      promptContext.systemPrompt,
      promptContext.userPrompt,
      context.memory
    );

    return {
      text: llmRes.text,
      confidence: 0.95,
      actions: [],
      artifacts: [],
      metadata: {
        agent: this.name,
        llmUsed: llm.name,
        ...llmRes.metadata,
      },
    };
  }
}
