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
import {
  pullRequestOpenedPayload,
  issueCommentPayload,
  fakeGitHubClient,
} from '../helpers/fixtures.js';

function buildWiring(githubClient: ReturnType<typeof fakeGitHubClient>) {
  const dedup = new DeduplicationService();
  const conv = new ConversationService();
  const ident = new IdentityService();
  const persist = new MessagePersistenceService();
  const bus = new EventBus();
  const replies: string[] = [];

  const commService = new CommunicationService(dedup, conv, ident, persist, async (envelope) => {
    envelope.respond = async (text: string) => {
      replies.push(text);
    };
    await bus.publish(envelope as any);
  });

  const agentRuntime = new AgentRuntime({ demoMode: true, githubClient });
  bus.subscribe(async (envelope) => {
    if (envelope.payload) await agentRuntime.processEvent(envelope);
  });

  return { commService, replies };
}

describe('PR Summary auto-trigger on pull_request opened (#21)', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('summarizes a freshly-opened PR without being asked, grounded in the real file list', async () => {
    const client = fakeGitHubClient([], {
      pullRequestFiles: [
        { filename: 'src/path.ts', status: 'modified', additions: 10, deletions: 3, changes: 13 },
        {
          filename: '.github/workflows/ci.yml',
          status: 'modified',
          additions: 2,
          deletions: 0,
          changes: 2,
        },
      ],
    });
    const { commService, replies } = buildWiring(client);

    const normalized = normalizeGitHubWebhookEvent({
      eventName: 'pull_request',
      deliveryId: `pr-open-${Date.now()}`,
      payload: pullRequestOpenedPayload(),
    })!;
    await commService.ingest(normalized.rawMessage, 'github');

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('## PR Summary');
    expect(replies[0]).toContain('src/path.ts');
    expect(replies[0]).toContain('CI/workflow');
  });

  it('summarizes on an explicit "summarize this PR" request in a PR comment thread', async () => {
    const client = fakeGitHubClient([], {
      pullRequestFiles: [
        { filename: 'src/thing.ts', status: 'modified', additions: 4, deletions: 1, changes: 5 },
      ],
    });
    const { commService, replies } = buildWiring(client);

    const normalized = normalizeGitHubWebhookEvent({
      eventName: 'issue_comment',
      deliveryId: `pr-ask-${Date.now()}`,
      payload: issueCommentPayload(
        {
          comment: {
            id: 1,
            body: 'Can you summarize this PR?',
            html_url: 'https://x',
            created_at: new Date().toISOString(),
            user: { id: 1, login: 'someone' },
          },
        },
        { onPullRequest: true }
      ),
    })!;
    await commService.ingest(normalized.rawMessage, 'github');

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('## PR Summary');
    expect(replies[0]).toContain('src/thing.ts');
  });

  it('degrades gracefully when no GitHub client is configured', async () => {
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
    const agentRuntime = new AgentRuntime({ demoMode: true }); // no githubClient
    bus.subscribe(async (envelope) => {
      if (envelope.payload) await agentRuntime.processEvent(envelope);
    });

    const normalized = normalizeGitHubWebhookEvent({
      eventName: 'pull_request',
      deliveryId: `pr-open-nogh-${Date.now()}`,
      payload: pullRequestOpenedPayload(),
    })!;
    await commService.ingest(normalized.rawMessage, 'github');

    expect(replies).toHaveLength(1);
    expect(replies[0]).not.toContain('## PR Summary');
    expect(replies[0]).toMatch(/repository access/i);
  });
});
