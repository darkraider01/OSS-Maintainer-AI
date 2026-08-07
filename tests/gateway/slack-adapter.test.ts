import { beforeAll, describe, expect, it, vi } from 'vitest';
import { slackAdapter } from '../../src/gateway/adapters/slack.js';
import { githubAdapter } from '../../src/gateway/adapters/github.js';
import { InboundMessage } from '../../src/gateway/caspian/inbound-message.js';
import { CommunicationService } from '../../src/gateway/adapters/communication-service.js';
import { DeduplicationService } from '../../src/gateway/adapters/deduplication-service.js';
import { ConversationService } from '../../src/gateway/adapters/conversation-service.js';
import { IdentityService } from '../../src/gateway/adapters/identity-service.js';
import { MessagePersistenceService } from '../../src/gateway/adapters/message-persistence-service.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';

describe('Slack Adapter & Subsystem Integration', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  const rawSlackMessage: InboundMessage = {
    id: 'slack_msg_100',
    conversationId: 'C_SLACK_123',
    connectionId: 'conn_slack_456',
    customerId: 'cust_789',
    agentId: 'agent_abc',
    channel: 'slack',
    sender: {
      id: 'U_SLACK_USER',
      username: 'slack_bot_tester',
      display_name: 'Slack Bot Tester',
    },
    subject: null,
    text: 'Hello from Slack! @agent',
    html: null,
    raw: {
      ts: '17890000.000100',
      thread_ts: '17890000.000000',
    },
  };

  it('correctly normalizes Slack payloads', () => {
    const event = slackAdapter.normalize(rawSlackMessage);
    expect(event.provider).toBe('slack');
    expect(event.id).toBe('slack:slack_msg_100');
    expect(event.actorReference.providerActorId).toBe('U_SLACK_USER');
    expect(event.actorReference.handle).toBe('slack_bot_tester');
    expect(event.actorReference.displayName).toBe('Slack Bot Tester');
    expect(event.conversationReference.conversationId).toBe('C_SLACK_123');
    expect(event.rawPayload.slack_reference).toEqual({
      channelId: 'C_SLACK_123',
      ts: '17890000.000100',
      threadTs: '17890000.000000',
    });
  });

  it('manages conversation mapping, identity resolution, self-event detection, and deduplication inside CommunicationService', async () => {
    const dedup = new DeduplicationService();
    const conv = new ConversationService();
    const ident = new IdentityService();
    const persist = new MessagePersistenceService();
    const publisher = vi.fn();

    const commService = new CommunicationService(dedup, conv, ident, persist, publisher);

    // Ingest Slack message
    const envelope = await commService.ingest(
      {
        id: rawSlackMessage.id,
        conversationId: rawSlackMessage.conversationId,
        channel: 'slack',
        sender: {
          id: rawSlackMessage.sender!.id,
          username: rawSlackMessage.sender!.username,
        },
        text: rawSlackMessage.text,
      },
      'slack'
    );

    expect(envelope).not.toBeNull();
    expect(envelope!.payload.provider).toBe('slack');
    expect(envelope!.payload.actorId).toBeDefined();
    expect(envelope!.payload.conversationId).toBeDefined();
    expect(publisher).toHaveBeenCalledOnce();

    // Verify duplicate event is dropped
    const retryEnvelope = await commService.ingest(
      {
        id: rawSlackMessage.id,
        conversationId: rawSlackMessage.conversationId,
        channel: 'slack',
        sender: {
          id: rawSlackMessage.sender!.id,
          username: rawSlackMessage.sender!.username,
        },
        text: rawSlackMessage.text,
      },
      'slack'
    );
    expect(retryEnvelope).toBeNull();
    expect(publisher).toHaveBeenCalledOnce(); // Still 1

    // Verify self-event loop filtering
    // 1. Resolve actor with bot role
    const botActorId = await ident.resolveActor({
      provider: 'slack',
      providerUserId: 'B_BOT_USER',
      username: 'agent_bot',
    });
    // Register it as agent
    const { db } = await import('../../src/db/client.js');
    const { actors } = await import('../../src/db/schema/actors.js');
    const { eq } = await import('drizzle-orm');
    await db.update(actors).set({ type: 'agent' }).where(eq(actors.id, botActorId));

    // 2. Ingest message from bot itself
    const botEnvelope = await commService.ingest(
      {
        id: 'slack_msg_101',
        conversationId: rawSlackMessage.conversationId,
        channel: 'slack',
        sender: {
          id: 'B_BOT_USER',
          username: 'agent_bot',
        },
        text: 'Self message response loop test',
      },
      'slack'
    );
    expect(botEnvelope).toBeNull(); // Dropped
  });

  it('produces structurally equivalent UnifiedEvent payloads for GitHub and Slack', () => {
    const rawGithubMessage: InboundMessage = {
      id: 'github_msg_200',
      conversationId: 'gh_issue_99',
      connectionId: 'conn_gh_456',
      customerId: 'cust_789',
      agentId: 'agent_abc',
      channel: 'github',
      sender: {
        id: '4242',
        login: 'octocat',
        display_name: 'The Octocat',
      },
      subject: 'issue-comment',
      text: 'Hello from GitHub!',
      html: null,
      raw: {},
    };

    const rawSlackEquivalent: InboundMessage = {
      id: 'slack_msg_200',
      conversationId: 'slack_chan_99',
      connectionId: 'conn_slack_456',
      customerId: 'cust_789',
      agentId: 'agent_abc',
      channel: 'slack',
      sender: {
        id: '4242',
        username: 'octocat',
        display_name: 'The Octocat',
      },
      subject: null,
      text: 'Hello from GitHub!',
      html: null,
      raw: {},
    };

    const ghEvent = githubAdapter.normalize(rawGithubMessage);
    const slackEvent = slackAdapter.normalize(rawSlackEquivalent);

    // Standard structural equivalence checks (independent of provider specific metadata)
    expect(ghEvent.text).toBe(slackEvent.text);
    expect(ghEvent.actorReference.displayName).toBe(slackEvent.actorReference.displayName);
    expect(ghEvent.actorReference.providerActorId).toBe(slackEvent.actorReference.providerActorId);
    expect(ghEvent.actorReference.handle).toBe(slackEvent.actorReference.handle);
    expect(ghEvent.subject).not.toBe(slackEvent.subject); // Subject is GitHub specific
  });
});
