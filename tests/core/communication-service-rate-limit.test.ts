import { beforeAll, describe, expect, it } from 'vitest';
import { CommunicationService } from '../../src/gateway/adapters/communication-service.js';
import { DeduplicationService } from '../../src/gateway/adapters/deduplication-service.js';
import { ConversationService } from '../../src/gateway/adapters/conversation-service.js';
import { IdentityService } from '../../src/gateway/adapters/identity-service.js';
import { MessagePersistenceService } from '../../src/gateway/adapters/message-persistence-service.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';

describe('CommunicationService rate limiting (#26)', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('drops events from an actor once it exceeds the per-actor limit, without throwing', async () => {
    const commService = new CommunicationService(
      new DeduplicationService(),
      new ConversationService(),
      new IdentityService(),
      new MessagePersistenceService(),
      async () => {}
    );

    const conversationId = `C_RATE_${Date.now()}`;
    const results: Array<unknown> = [];
    for (let i = 0; i < 25; i += 1) {
      results.push(
        await commService.ingest(
          {
            id: `rate_msg_${i}`,
            conversationId,
            channel: 'slack',
            sender: { id: 'U_SPAMMER', username: 'spammer' },
            text: `message ${i}`,
          },
          'slack'
        )
      );
    }

    const accepted = results.filter((r) => r !== null);
    const dropped = results.filter((r) => r === null);

    expect(accepted.length).toBe(20);
    expect(dropped.length).toBe(5);
  });
});
