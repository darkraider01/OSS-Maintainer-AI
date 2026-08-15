import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CommunicationService } from '../../src/gateway/adapters/communication-service.js';
import { DeduplicationService } from '../../src/gateway/adapters/deduplication-service.js';
import { ConversationService } from '../../src/gateway/adapters/conversation-service.js';
import { IdentityService } from '../../src/gateway/adapters/identity-service.js';
import { MessagePersistenceService } from '../../src/gateway/adapters/message-persistence-service.js';
import { db } from '../../src/db/client.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';

describe('Communication Normalization Layer Subsystem', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });
  it('correctly ingests, normalizes, maps identities, and deduplicates events', async () => {
    const dedup = new DeduplicationService();
    const conv = new ConversationService();
    const ident = new IdentityService();
    const persist = new MessagePersistenceService();
    const publisher = vi.fn();

    const commService = new CommunicationService(dedup, conv, ident, persist, publisher);

    const rawMessage = {
      id: 'msg_999',
      conversationId: 'github_issue_45',
      channel: 'github',
      sender: {
        id: 'user_123',
        login: 'test_contributor',
        name: 'Test Contributor',
      },
      text: 'Testing normalizer layers',
      eventType: 'MESSAGE_CREATED',
      messageType: 'text',
    };

    // First ingestion (successful resolution and persist)
    const envelope = await commService.ingest(rawMessage, 'github');
    expect(envelope).not.toBeNull();
    expect(envelope!.correlationId).toBeDefined();
    expect(envelope!.payload.actorId).toBeDefined();
    expect(envelope!.payload.conversationId).toBeDefined();
    expect(publisher).toHaveBeenCalledOnce();

    // Deduplication check
    const retryEnvelope = await commService.ingest(rawMessage, 'github');
    expect(retryEnvelope).toBeNull();
    expect(publisher).toHaveBeenCalledOnce(); // No new calls
  });

  it('resolves distinct conversations from snake_case conversation_id (Caspian\'s real wire format), not the "default_thread" collapse', async () => {
    // Regression test: Caspian's actual Slack/Discord ingress (fromSdkMessage
    // / fromEventRecord in src/gateway/caspian/inbound-message.ts) delivers
    // the thread id as `conversation_id`, not `conversationId`. Reading only
    // the camelCase key silently collapsed every Slack/Discord conversation,
    // from every user, into one shared 'default_thread' row.
    const dedup = new DeduplicationService();
    const conv = new ConversationService();
    const ident = new IdentityService();
    const persist = new MessagePersistenceService();
    const publisher = vi.fn();
    const commService = new CommunicationService(dedup, conv, ident, persist, publisher);

    const messageA = {
      id: 'slack_msg_a',
      conversation_id: 'slack_thread_alice',
      channel: 'slack',
      sender: { id: 'alice', username: 'alice' },
      text: 'hello from alice',
    };
    const messageB = {
      id: 'slack_msg_b',
      conversation_id: 'slack_thread_bob',
      channel: 'slack',
      sender: { id: 'bob', username: 'bob' },
      text: 'hello from bob',
    };

    const envelopeA = await commService.ingest(messageA, 'slack');
    const envelopeB = await commService.ingest(messageB, 'slack');

    expect(envelopeA).not.toBeNull();
    expect(envelopeB).not.toBeNull();
    expect(envelopeA!.payload.conversationId).not.toBe(envelopeB!.payload.conversationId);
  });

  it('resolves the same actor for a sender identified only by "address" (a Slack thread reply) as for one identified by "id"', async () => {
    // Regression: a live Slack thread reply came in shaped as
    // { address: 'U0BNR40VBGV', name: null } - no `id` field at all. The
    // identity lookup only checked ['id','user_id','provider_id',
    // 'providerActorId'], so it silently minted a brand-new "unknown"
    // actor instead of matching the sender's real, already-linked account -
    // splitting their history across two identities and breaking the
    // account-linking feature for that message.
    const dedup = new DeduplicationService();
    const conv = new ConversationService();
    const ident = new IdentityService();
    const persist = new MessagePersistenceService();
    const publisher = vi.fn();
    const commService = new CommunicationService(dedup, conv, ident, persist, publisher);

    const firstMessage = {
      id: 'slack_top_level',
      conversation_id: 'slack_thread_1',
      channel: 'slack',
      sender: { id: 'TEST_ONLY_ADDRESS_SENDER', name: 'buckie' },
      text: 'hey',
    };
    const threadReply = {
      id: 'slack_thread_reply',
      conversation_id: 'slack_thread_2',
      channel: 'slack',
      sender: { address: 'TEST_ONLY_ADDRESS_SENDER', name: null },
      text: 'a follow-up in a thread',
    };

    const firstEnvelope = await commService.ingest(firstMessage, 'slack');
    const replyEnvelope = await commService.ingest(threadReply, 'slack');

    expect(firstEnvelope).not.toBeNull();
    expect(replyEnvelope).not.toBeNull();
    expect(replyEnvelope!.payload.actorId).toBe(firstEnvelope!.payload.actorId);
  });
});
