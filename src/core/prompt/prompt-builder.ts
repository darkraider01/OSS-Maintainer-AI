import type {
  UnifiedEvent,
  ConversationContext,
  RepositoryContext,
} from '../../gateway/adapters/communication-types.js';
import type { PromptContext } from '../agent/agent-types.js';
import type { ContributorProfile } from '../contributor/contributor-profile-types.js';
import { formatContributorProfileForPrompt } from '../contributor/contributor-profile-service.js';

export class PromptBuilder {
  build(
    event: UnifiedEvent,
    conversation: ConversationContext,
    repository?: RepositoryContext | null,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    actorName?: string | null,
    connectedProfiles: Array<{ provider: string; username: string }> = [],
    crossChannelHistory: Array<{
      role: 'user' | 'assistant';
      content: string;
      conversationId: string;
    }> = [],
    contributorProfile: ContributorProfile | null = null
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

    const profileStrings = connectedProfiles
      .map((p) => `- ${p.provider}: ${p.username}`)
      .join('\n');
    const profilesPrompt =
      connectedProfiles.length > 0
        ? `Connected user profiles on other platforms:\n${profileStrings}`
        : `No other connected platform profiles.`;

    const crossChannelStrings = crossChannelHistory
      .map(
        (m) => `- [Platform: ${m.conversationId.split(':')[0] || 'other'}] ${m.role}: ${m.content}`
      )
      .join('\n');
    const crossChannelPrompt =
      crossChannelHistory.length > 0
        ? `Recent Context from user's other channels:\n${crossChannelStrings}`
        : `No prior context from other channels.`;

    const actorDisplayName = actorName
      ? `${actorName} (ID: ${event.actorId})`
      : `actor (ID: ${event.actorId})`;
    const userPrompt = [
      `New Message from ${actorDisplayName}:`,
      `> ${event.text || '(empty message)'}`,
      '',
      formatContributorProfileForPrompt(contributorProfile),
      '',
      profilesPrompt,
      '',
      crossChannelPrompt,
      '',
      historyPrompt,
    ].join('\n');

    return {
      systemPrompt,
      userPrompt,
    };
  }
}
