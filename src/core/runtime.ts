import { AgentRegistry } from './agent/agent-types.js';
import { MaintainerAgent } from './agent/maintainer-agent.js';
import { PromptBuilder } from './prompt/prompt-builder.js';
import { LiveLLMProvider, MockLLMProvider } from './llm/llm-provider.js';
import type { LLMProvider } from './llm/llm-provider.js';
import { OutputAdapters } from './workflow/output-adapters.js';
import { WorkflowEngine } from './workflow/workflow-engine.js';
import type { EventEnvelope } from '../gateway/adapters/communication-types.js';

export class MemoryService {
  // Database-backed operations are handled inline inside WorkflowEngine using Drizzle ORM.
  // This class remains a clean architectural boundary for future RAG / semantic memory extensions.
}

export class Runtime {
  readonly agentRegistry: AgentRegistry;
  readonly promptBuilder: PromptBuilder;
  readonly llmProvider: LLMProvider;
  readonly outputAdapters: OutputAdapters;
  readonly workflowEngine: WorkflowEngine;
  readonly memoryService: MemoryService;

  constructor(options?: { demoMode?: boolean; apiKey?: string; provider?: string }) {
    this.agentRegistry = new AgentRegistry();
    this.promptBuilder = new PromptBuilder();
    this.outputAdapters = new OutputAdapters();
    this.memoryService = new MemoryService();

    // Configure LLM provider based on demo configuration
    const isDemo = options?.demoMode ?? true;
    if (isDemo) {
      this.llmProvider = new MockLLMProvider();
    } else {
      this.llmProvider = new LiveLLMProvider(options?.apiKey || '', options?.provider || 'gemini');
    }

    // Register initial default MaintainerAgent
    this.agentRegistry.register(new MaintainerAgent());

    this.workflowEngine = new WorkflowEngine(
      this.agentRegistry,
      this.promptBuilder,
      this.llmProvider,
      this.outputAdapters
    );
  }

  /**
   * Main entry point to process a workflow event from the bus.
   */
  async processEvent(envelope: EventEnvelope): Promise<void> {
    await this.workflowEngine.handleEvent(envelope);
  }
}
