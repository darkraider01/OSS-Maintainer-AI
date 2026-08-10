import { beforeAll, describe, expect, it, vi } from 'vitest';
import { normalizeGitHubWebhookEvent } from '../../src/gateway/adapters/github.js';
import { CommunicationService } from '../../src/gateway/adapters/communication-service.js';
import { DeduplicationService } from '../../src/gateway/adapters/deduplication-service.js';
import { ConversationService } from '../../src/gateway/adapters/conversation-service.js';
import { IdentityService } from '../../src/gateway/adapters/identity-service.js';
import { MessagePersistenceService } from '../../src/gateway/adapters/message-persistence-service.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';
import {
  issuesOpenedPayload,
  issueCommentPayload,
  githubBotSender,
} from '../helpers/fixtures.js';

function buildCommService() {
  const dedup = new DeduplicationService();
  const conv = new ConversationService();
  const ident = new IdentityService();
  const persist = new MessagePersistenceService();
  const publisher = vi.fn();
  const commService = new CommunicationService(dedup, conv, ident, persist, publisher);
  return { commService, ident, publisher };
}

describe('GitHub identity and conversation resolution', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('resolves the same actor across multiple GitHub events from the same user', async () => {
    const { commService } = buildCommService();

    const first = normalizeGitHubWebhookEvent({
      eventName: 'issues',
      deliveryId: 'actor-delivery-1',
      payload: issuesOpenedPayload(),
    })!;
    // Same sender (id 4242 / login "octocat") as the issue, to test actor stability.
    const second = normalizeGitHubWebhookEvent({
      eventName: 'issue_comment',
      deliveryId: 'actor-delivery-2',
      payload: issueCommentPayload({ sender: { id: 4242, login: 'octocat' } }),
    })!;

    const envelope1 = await commService.ingest(first.rawMessage, 'github');
    const envelope2 = await commService.ingest(second.rawMessage, 'github');

    expect(envelope1).not.toBeNull();
    expect(envelope2).not.toBeNull();
    expect(envelope1!.payload.actorId).toBe(envelope2!.payload.actorId);
  });

  it('resolves an issue and a follow-up comment on it to the same conversation', async () => {
    const { commService } = buildCommService();

    const issueOpened = normalizeGitHubWebhookEvent({
      eventName: 'issues',
      deliveryId: 'conv-delivery-1',
      payload: issuesOpenedPayload({
        issue: { number: 501, title: 'Same conversation test', body: 'body', user: { id: 1 } },
      }),
    })!;
    const followUpComment = normalizeGitHubWebhookEvent({
      eventName: 'issue_comment',
      deliveryId: 'conv-delivery-2',
      payload: issueCommentPayload({
        issue: { number: 501, title: 'Same conversation test', user: { id: 1 } },
      }),
    })!;
    const secondComment = normalizeGitHubWebhookEvent({
      eventName: 'issue_comment',
      deliveryId: 'conv-delivery-3',
      payload: issueCommentPayload({
        issue: { number: 501, title: 'Same conversation test', user: { id: 1 } },
        comment: { id: 9, body: 'a third message', user: { id: 1 } },
      }),
    })!;

    const envelope1 = await commService.ingest(issueOpened.rawMessage, 'github');
    const envelope2 = await commService.ingest(followUpComment.rawMessage, 'github');
    const envelope3 = await commService.ingest(secondComment.rawMessage, 'github');

    expect(envelope1!.payload.conversationId).toBe(envelope2!.payload.conversationId);
    expect(envelope2!.payload.conversationId).toBe(envelope3!.payload.conversationId);
  });

  it('drops a webhook authored by the bot itself once its actor is marked as bot', async () => {
    const { commService, ident } = buildCommService();

    const botSender = githubBotSender();
    const botActorId = await ident.resolveActor({
      provider: 'github',
      providerUserId: String((botSender as any).id),
      username: (botSender as any).login,
    });
    const { db } = await import('../../src/db/client.js');
    const { actors } = await import('../../src/db/schema/actors.js');
    const { eq } = await import('drizzle-orm');
    await db.update(actors).set({ type: 'bot' }).where(eq(actors.id, botActorId));

    const selfComment = normalizeGitHubWebhookEvent({
      eventName: 'issue_comment',
      deliveryId: 'self-event-delivery',
      payload: issueCommentPayload({ sender: botSender, comment: { id: 12345, body: 'echo', user: botSender } }),
    })!;

    const envelope = await commService.ingest(selfComment.rawMessage, 'github');
    expect(envelope).toBeNull();
  });

  it('drops a redelivered webhook with the same X-GitHub-Delivery id', async () => {
    const { commService, publisher } = buildCommService();

    const normalized = normalizeGitHubWebhookEvent({
      eventName: 'issues',
      deliveryId: 'dup-delivery-1',
      payload: issuesOpenedPayload(),
    })!;

    const first = await commService.ingest(normalized.rawMessage, 'github');
    const retry = await commService.ingest(normalized.rawMessage, 'github');

    expect(first).not.toBeNull();
    expect(retry).toBeNull();
    expect(publisher).toHaveBeenCalledOnce();
  });
});
