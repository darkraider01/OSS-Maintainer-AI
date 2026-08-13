import { describe, expect, it, vi } from 'vitest';
import { OnboardingWorkflow } from '../../src/core/workflow/workflows/onboarding-workflow.js';
import { fakeGitHubClient } from '../helpers/fixtures.js';
import type { AgentContext } from '../../src/core/agent/agent-types.js';
import type { IntentClassificationResult } from '../../src/core/intent/intent-types.js';

function baseContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    event: {
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
      text: 'How can I start contributing?',
      attachments: [],
      mentions: [],
      replyToId: null,
      metadata: {},
      rawPayload: {},
    },
    conversationContext: {
      conversationId: 'conv_1',
      providerThreadId: 't1',
      providerChannelId: 'c1',
      conversationType: 'issue',
      participants: [],
      createdAt: new Date().toISOString(),
    },
    repositoryContext: {
      provider: 'github',
      owner: 'darkraider01',
      repositoryName: 'OSS-Maintainer-AI',
    },
    memory: [],
    promptContext: { systemPrompt: '', userPrompt: '' },
    llm: {
      name: 'mock',
      supportsTools: () => false,
      supportsVision: () => false,
      supportsReasoning: () => false,
      generate: vi.fn(),
      generateWithTools: vi.fn(),
      embed: vi.fn(),
    },
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    } as any,
    config: {},
    tools: [],
    escalation: { failureStreak: 0 },
    triageState: null,
    ...overrides,
  };
}

const classification: IntentClassificationResult = {
  intent: 'contribution_question',
  confidence: 0.8,
  signals: ['start contributing'],
};

describe('OnboardingWorkflow', () => {
  it('surfaces CONTRIBUTING.md, README, and good-first-issue items when available', async () => {
    const client = fakeGitHubClient([], {
      docs: [
        { path: 'README.md', content: '# readme' },
        { path: 'CONTRIBUTING.md', content: '# contributing' },
      ],
      goodFirstIssues: [
        { number: 12, title: 'Fix typo', htmlUrl: 'https://github.com/x/y/issues/12' },
      ],
    });
    const workflow = new OnboardingWorkflow(client);

    const response = await workflow.execute(baseContext(), classification);

    expect(response.text).toContain('CONTRIBUTING.md');
    expect(response.text).toContain('README.md');
    expect(response.text).toContain('#12 Fix typo');
    expect(response.metadata.docsFound).toBe(true);
  });

  it('explicitly says docs are unavailable rather than inventing them', async () => {
    const client = fakeGitHubClient([], { docs: [], goodFirstIssues: [] });
    const workflow = new OnboardingWorkflow(client);

    const response = await workflow.execute(baseContext(), classification);

    expect(response.text).toContain('no CONTRIBUTING.md found');
    expect(response.text).toContain('no README found');
    expect(response.text).toContain('none currently labeled');
  });

  it('degrades gracefully with no repository context or GitHub client at all', async () => {
    const workflow = new OnboardingWorkflow(null);
    const response = await workflow.execute(
      baseContext({ repositoryContext: undefined }),
      classification
    );

    expect(response.metadata.reason).toBe('no_repository_context');
    expect(response.text).not.toMatch(/CONTRIBUTING\.md\` —/); // no fabricated file reference
  });
});
