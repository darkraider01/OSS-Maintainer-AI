import type {
  UnifiedEvent,
  ConversationContext,
  RepositoryContext,
} from '../../gateway/adapters/communication-types.js';
import type { PromptContext } from '../agent/agent-types.js';

export class PromptBuilder {
  build(
    event: UnifiedEvent,
    conversation: ConversationContext,
    repository?: RepositoryContext | null,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): PromptContext {
    const systemPrompt = [
      `You are the OSS Maintainer AI, a helpful agent answering project threads.`,
      `Channel Provider: ${event.provider}`,
      `Conversation Thread: ${conversation.providerThreadId}`,
      repository
        ? `Repository: ${repository.owner}/${repository.repositoryName}`
        : `No repository context available.`,
      `Maintain a polite and professional tone.`,
    ].join('\n');

    const historyPrompt =
      history.length > 0
        ? `Recent Thread History:\n` + history.map((m) => `- ${m.role}: ${m.content}`).join('\n')
        : `No prior thread history.`;

    const userPrompt = [
      `New Message from actor (ID: ${event.actorId}):`,
      `> ${event.text || '(empty message)'}`,
      '',
      historyPrompt,
    ].join('\n');

    return {
      systemPrompt,
      userPrompt,
    };
  }
}
