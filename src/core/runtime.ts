import { AgentRegistry } from './agent/agent-types.js';
import { MaintainerAgent } from './agent/maintainer-agent.js';
import { PromptBuilder } from './prompt/prompt-builder.js';
import { LiveLLMProvider, MockLLMProvider } from './llm/llm-provider.js';
import type { LLMProvider } from './llm/llm-provider.js';
import { OutputAdapters } from './workflow/output-adapters.js';
import { WorkflowEngine } from './workflow/workflow-engine.js';
import { WorkflowRouter } from './workflow/workflow-router.js';
import { GeneralWorkflow } from './workflow/workflows/general-workflow.js';
import { TriageWorkflow } from './workflow/workflows/triage-workflow.js';
import { OnboardingWorkflow } from './workflow/workflows/onboarding-workflow.js';
import { PRSummaryWorkflow } from './workflow/workflows/pr-summary-workflow.js';
import { DefaultEscalationWorkflow } from './workflow/workflows/escalation-workflow.js';
import { ConversationStateStore } from './state/conversation-state-store.js';
import { ToolRegistry } from './tools/tool-registry.js';
import { SearchDocumentationTool } from './tools/search-documentation-tool.js';
import type { MaintainerMentionConfig } from './escalation/maintainer-mention.js';
import type { EventEnvelope } from '../gateway/adapters/communication-types.js';
import type { GitHubClientLike } from '../gateway/github/client.js';

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
  readonly workflowRouter: WorkflowRouter;
  readonly memoryService: MemoryService;

  constructor(options?: {
    demoMode?: boolean;
    apiKey?: string;
    provider?: string;
    githubClient?: GitHubClientLike | null;
    maintainerMentionConfig?: MaintainerMentionConfig;
  }) {
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

    // General Q&A's real tool: semantic search over ingested docs (#10).
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(new SearchDocumentationTool());

    // One MaintainerAgent, routed internally to Triage/Onboarding/Escalation/
    // General workflows (PRD §18) rather than separate per-workflow agents.
    this.workflowRouter = new WorkflowRouter(
      new DefaultEscalationWorkflow(options?.maintainerMentionConfig ?? {})
    );
    this.workflowRouter.register('general_qa', new GeneralWorkflow(toolRegistry));
    this.workflowRouter.register('bug_report', new TriageWorkflow());
    this.workflowRouter.register(
      'contribution_question',
      new OnboardingWorkflow(options?.githubClient ?? null)
    );
    this.workflowRouter.register(
      'pr_summary_request',
      new PRSummaryWorkflow(options?.githubClient ?? null)
    );

    this.agentRegistry.register(new MaintainerAgent(this.workflowRouter));

    this.workflowEngine = new WorkflowEngine(
      this.agentRegistry,
      this.promptBuilder,
      this.llmProvider,
      this.outputAdapters,
      new ConversationStateStore()
    );
  }

  /**
   * Main entry point to process a workflow event from the bus.
   */
  async processEvent(envelope: EventEnvelope): Promise<void> {
    await this.workflowEngine.handleEvent(envelope);
  }
}
