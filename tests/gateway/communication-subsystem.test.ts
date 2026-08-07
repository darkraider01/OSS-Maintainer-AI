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
});
