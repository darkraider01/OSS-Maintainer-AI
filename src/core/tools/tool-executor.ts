import type { AgentContext } from '../agent/agent-types.js';
import type { LLMProvider } from '../llm/llm-provider.js';
import type { ToolRegistry } from './tool-registry.js';

export interface ToolCallLogEntry {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
}

export interface ToolCallingRunResult {
  text: string;
  toolCallLog: ToolCallLogEntry[];
}

/**
 * Bounded tool-calling: ask the model whether it wants to call a tool; if it
 * does, execute it and ask once more with tools disabled, so the model is
 * forced to give a final text answer grounded in the result. Not a full
 * ReAct/multi-step loop — one grounding lookup per turn is what this app's
 * tools need today (search_documentation is the only one registered), and
 * an unbounded loop is exactly the complexity PRD §11 says to avoid.
 */
export class ToolExecutor {
  constructor(private readonly registry: ToolRegistry) {}

  async run(params: {
    llm: LLMProvider;
    systemPrompt: string;
    userPrompt: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    toolContext: AgentContext;
  }): Promise<ToolCallingRunResult> {
    const { llm, systemPrompt, userPrompt, history, toolContext } = params;
    const toolCallLog: ToolCallLogEntry[] = [];
    const tools = this.registry.definitions();

    if (!llm.supportsTools() || tools.length === 0) {
      const response = await llm.generate(systemPrompt, userPrompt, history);
      return { text: response.text, toolCallLog };
    }

    const firstPass = await llm.generateWithTools(systemPrompt, userPrompt, tools, history);
    if (firstPass.toolCalls.length === 0) {
      return { text: firstPass.text ?? '', toolCallLog };
    }

    const resultSections: string[] = [];
    for (const call of firstPass.toolCalls) {
      const tool = this.registry.find(call.name);
      const result = tool
        ? await tool.execute(call.arguments, toolContext)
        : { error: `Unknown tool: ${call.name}` };
      toolCallLog.push({ name: call.name, arguments: call.arguments, result });
      resultSections.push(`[Tool "${call.name}" result]:\n${JSON.stringify(result)}`);
    }

    const followUpPrompt = [
      userPrompt,
      '',
      ...resultSections,
      '',
      'Using the tool result(s) above, answer the original message. If the results are irrelevant or empty, say so honestly rather than making something up.',
    ].join('\n');

    // Empty tools array forces a final text answer instead of another tool request.
    const finalPass = await llm.generateWithTools(systemPrompt, followUpPrompt, [], history);
    return { text: finalPass.text ?? '', toolCallLog };
  }
}
