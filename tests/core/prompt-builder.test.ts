import { describe, expect, it } from 'vitest';
import { PromptBuilder } from '../../src/core/prompt/prompt-builder.js';
import type { UnifiedEvent, ConversationContext } from '../../src/gateway/adapters/communication-types.js';

function baseEvent(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return {
    id: 'evt_1',
    provider: 'github',
    providerEventId: 'evt_1',
    eventType: 'MESSAGE_CREATED',
    messageType: 'text',
    occurredAt: new Date().toISOString(),
    actorId: 'actor_1',
    conversationId: 'conv_1',
    conversationContext: {
      conversationId: 'conv_1',
      providerThreadId: 't1',
      providerChannelId: 'c1',
      conversationType: 'issue',
      participants: [],
      createdAt: new Date().toISOString(),
    },
    subject: null,
    text: 'could you explain me the issue',
    attachments: [],
    mentions: [],
    replyToId: null,
    metadata: {},
    rawPayload: {},
    ...overrides,
  };
}

const conversation: ConversationContext = {
  conversationId: 'conv_1',
  providerThreadId: 't1',
  providerChannelId: 'c1',
  conversationType: 'issue',
  participants: [],
  createdAt: new Date().toISOString(),
};

describe('PromptBuilder', () => {
  it('includes the issue title and body in the system prompt when repositoryContext carries them', () => {
    // Regression: a GitHub comment on an existing issue previously produced
    // a prompt with zero information about what that issue actually says —
    // the LLM only ever saw the comment text in isolation.
    const builder = new PromptBuilder();
    const { systemPrompt } = builder.build(baseEvent(), conversation, {
      provider: 'github',
      owner: 'darkraider01',
      repositoryName: 'OSS-Maintainer-AI',
      issueTitle: 'Load/scale testing across multiple repos and conversations',
      issueBody: 'Validate against NFR targets: 99% availability, <3s latency for common queries.',
    });

    expect(systemPrompt).toContain(
      'Issue/PR Title: Load/scale testing across multiple repos and conversations'
    );
    expect(systemPrompt).toContain(
      'Validate against NFR targets: 99% availability, <3s latency for common queries.'
    );
  });

  it('omits the issue title/body lines when repositoryContext has none (e.g. Slack/Discord)', () => {
    const builder = new PromptBuilder();
    const { systemPrompt } = builder.build(baseEvent({ provider: 'slack' }), conversation, {
      provider: 'slack',
      owner: 'darkraider01',
      repositoryName: 'OSS-Maintainer-AI',
    });

    expect(systemPrompt).not.toContain('Issue/PR Title:');
    expect(systemPrompt).not.toContain('Issue/PR Description');
  });

  it('omits the issue title/body lines entirely when there is no repository context at all', () => {
    const builder = new PromptBuilder();
    const { systemPrompt } = builder.build(baseEvent(), conversation, null);

    expect(systemPrompt).toContain('No repository context available.');
    expect(systemPrompt).not.toContain('Issue/PR Title:');
  });
});
