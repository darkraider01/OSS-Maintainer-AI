import type { AgentContext, AgentResponse } from '../../agent/agent-types.js';
import type { IntentClassificationResult } from '../../intent/intent-types.js';
import type { Workflow } from '../workflow-types.js';
import { ToolExecutor } from '../../tools/tool-executor.js';
import { ToolRegistry } from '../../tools/tool-registry.js';

/**
 * Catch-all for general Q&A. Routes through `ToolExecutor` so the model can
 * ground its answer in `search_documentation` (#10) when it decides it
 * needs to, rather than always answering from the raw prompt alone — the
 * one place in this app tool-calling actually applies (Triage/Onboarding/
 * PR-summary/Escalation are structural, not "does the model need more
 * info?" decisions, so they don't use this).
 */
export class GeneralWorkflow implements Workflow {
  readonly name = 'general-workflow';
  private readonly toolExecutor: ToolExecutor;

  constructor(toolRegistry: ToolRegistry = new ToolRegistry()) {
    this.toolExecutor = new ToolExecutor(toolRegistry);
  }

  async execute(
    context: AgentContext,
    classification: IntentClassificationResult
  ): Promise<AgentResponse> {
    const result = await this.toolExecutor.run({
      llm: context.llm,
      systemPrompt: context.promptContext.systemPrompt,
      userPrompt: context.promptContext.userPrompt,
      history: context.memory,
      toolContext: context,
    });

    return {
      text: result.text,
      confidence: classification.confidence,
      actions: [],
      artifacts: [],
      metadata: {
        llmUsed: context.llm.name,
        toolCalls: result.toolCallLog.map((entry) => ({ tool: entry.name, args: entry.arguments })),
      },
    };
  }
}
