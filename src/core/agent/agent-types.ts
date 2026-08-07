import type {
  UnifiedEvent,
  ConversationContext,
  RepositoryContext,
} from '../../gateway/adapters/communication-types.js';
import type { LLMProvider } from '../llm/llm-provider.js';
import type { Logger } from 'pino';

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, context: AgentContext): Promise<unknown>;
}

export interface PromptContext {
  systemPrompt: string;
  userPrompt: string;
}

export interface AgentContext {
  event: UnifiedEvent;
  conversationContext: ConversationContext;
  repositoryContext?: RepositoryContext | null;
  memory: Array<{ role: 'user' | 'assistant'; content: string }>;
  promptContext: PromptContext;
  llm: LLMProvider;
  logger: Logger;
  config: Record<string, unknown>;
  tools: Tool[];
}

export interface AgentResponse {
  text: string;
  confidence: number;
  actions: Array<{ tool: string; args: Record<string, unknown> }>;
  artifacts: Array<{ name: string; content: string; type: string }>;
  metadata: Record<string, unknown>;
}

export interface Agent {
  name: string;
  description: string;
  systemInstructions: string;
  execute(context: AgentContext): Promise<AgentResponse>;
}

export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();

  register(agent: Agent): void {
    this.agents.set(agent.name.toLowerCase(), agent);
  }

  unregister(name: string): void {
    this.agents.delete(name.toLowerCase());
  }

  find(name: string): Agent | undefined {
    return this.agents.get(name.toLowerCase());
  }
}
