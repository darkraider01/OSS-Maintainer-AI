import { beforeAll, describe, expect, it } from 'vitest';
import { CommunicationService } from '../../src/gateway/adapters/communication-service.js';
import { DeduplicationService } from '../../src/gateway/adapters/deduplication-service.js';
import { ConversationService } from '../../src/gateway/adapters/conversation-service.js';
import { IdentityService } from '../../src/gateway/adapters/identity-service.js';
import { MessagePersistenceService } from '../../src/gateway/adapters/message-persistence-service.js';
import { EventBus } from '../../src/gateway/event-bus.js';
import { Runtime as AgentRuntime } from '../../src/core/runtime.js';
import { normalizeGitHubWebhookEvent } from '../../src/gateway/adapters/github.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';
import { issuesOpenedPayload, issueCommentPayload } from '../helpers/fixtures.js';

function buildWiring() {
  const dedup = new DeduplicationService();
  const conv = new ConversationService();
  const ident = new IdentityService();
  const persist = new MessagePersistenceService();
  const bus = new EventBus();
  const replies: Array<{ provider: string; text: string }> = [];

  const commService = new CommunicationService(dedup, conv, ident, persist, async (envelope) => {
    envelope.respond = async (text: string) => {
      replies.push({ provider: envelope.payload.provider, text });
    };
    await bus.publish(envelope as any);
  });

  const agentRuntime = new AgentRuntime({ demoMode: true });
  bus.subscribe(async (envelope) => {
    if (envelope.payload) await agentRuntime.processEvent(envelope);
  });

  return { commService, agentRuntime, replies };
}

describe('Issue Triage multi-turn + persistence (#18)', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('collects missing fields across turns on the same GitHub issue thread and completes', async () => {
    const { commService, replies } = buildWiring();

    const opened = normalizeGitHubWebhookEvent({
      eventName: 'issues',
      deliveryId: `triage-open-${Date.now()}`,
      payload: issuesOpenedPayload({
        issue: {
          id: 900001,
          number: 501,
          title: 'Crash on startup',
          body: 'The SDK crashes when I call connect(). Steps to reproduce: 1. install 2. run.',
          html_url: 'https://github.com/darkraider01/OSS-Maintainer-AI/issues/501',
          created_at: new Date().toISOString(),
          user: { id: 4242, login: 'octocat', type: 'User' },
        },
      }),
    })!;
    await commService.ingest(opened.rawMessage, 'github');

    expect(replies).toHaveLength(1);
    expect(replies[0].text).toContain('Could you provide');
    expect(replies[0].text).toContain('SDK/library version');

    const comment = normalizeGitHubWebhookEvent({
      eventName: 'issue_comment',
      deliveryId: `triage-comment-${Date.now()}`,
      payload: issueCommentPayload({
        issue: {
          id: 900001,
          number: 501,
          title: 'Crash on startup',
          html_url: 'https://github.com/darkraider01/OSS-Maintainer-AI/issues/501',
          user: { id: 4242, login: 'octocat', type: 'User' },
        },
        comment: {
          id: 900002,
          body: 'SDK version 2.1.0, Ubuntu 24.04, node v20. Error: Connection refused\n```\nTraceback (most recent call last)\n```',
          html_url:
            'https://github.com/darkraider01/OSS-Maintainer-AI/issues/501#issuecomment-900002',
          created_at: new Date().toISOString(),
          user: { id: 4242, login: 'octocat', type: 'User' },
        },
      }),
    })!;
    await commService.ingest(comment.rawMessage, 'github');

    expect(replies).toHaveLength(2);
    expect(replies[1].text).toContain('everything needed');
    expect(replies[1].text).not.toMatch(/i (?:have|'ve) created/i);
  });

  it('does not route a plain question about the same repo into Triage (non-bug conversation)', async () => {
    const { commService, replies } = buildWiring();

    const opened = normalizeGitHubWebhookEvent({
      eventName: 'issues',
      deliveryId: `nonbug-${Date.now()}`,
      payload: issuesOpenedPayload({
        issue: {
          id: 900010,
          number: 502,
          title: 'Question about config',
          body: 'What does the LOG_LEVEL option do?',
          html_url: 'https://github.com/darkraider01/OSS-Maintainer-AI/issues/502',
          created_at: new Date().toISOString(),
          user: { id: 4242, login: 'octocat', type: 'User' },
        },
      }),
    })!;
    await commService.ingest(opened.rawMessage, 'github');

    expect(replies).toHaveLength(1);
    expect(replies[0].text).toContain('[Mock LLM Response]');
  });
});

describe('Human Escalation (#20) — silences further autonomous replies', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('escalates on a sensitive-topic message and stops replying to later messages in the same conversation', async () => {
    const { commService, replies } = buildWiring();
    const conversationId = `C_ESCALATE_${Date.now()}`;

    await commService.ingest(
      {
        id: 'esc_msg_1',
        conversationId,
        channel: 'slack',
        sender: { id: 'U_ESC', username: 'reporter' },
        text: 'I found a security vulnerability — please escalate this to a maintainer.',
      },
      'slack'
    );

    expect(replies).toHaveLength(1);
    expect(replies[0].text).toContain('looping in a maintainer');

    await commService.ingest(
      {
        id: 'esc_msg_2',
        conversationId,
        channel: 'slack',
        sender: { id: 'U_ESC', username: 'reporter' },
        text: 'Any update?',
      },
      'slack'
    );

    // No second autonomous reply — conversation is under human control.
    expect(replies).toHaveLength(1);
  });

  it('@-mentions the configured maintainer in the escalation reply when one is configured for the provider', async () => {
    const dedup = new DeduplicationService();
    const conv = new ConversationService();
    const ident = new IdentityService();
    const persist = new MessagePersistenceService();
    const bus = new EventBus();
    const replies: string[] = [];

    const commService = new CommunicationService(dedup, conv, ident, persist, async (envelope) => {
      envelope.respond = async (text: string) => replies.push(text);
      await bus.publish(envelope as any);
    });
    const agentRuntime = new AgentRuntime({
      demoMode: true,
      maintainerMentionConfig: { slack: '<@U0MAINTAINER>' },
    });
    bus.subscribe(async (envelope) => {
      if (envelope.payload) await agentRuntime.processEvent(envelope);
    });

    await commService.ingest(
      {
        id: `esc_mention_msg_${Date.now()}`,
        conversationId: `C_ESC_MENTION_${Date.now()}`,
        channel: 'slack',
        sender: { id: 'U_ESC2', username: 'reporter2' },
        text: 'I found a security vulnerability — please escalate this to a maintainer.',
      },
      'slack'
    );

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('<@U0MAINTAINER>');
  });
});
