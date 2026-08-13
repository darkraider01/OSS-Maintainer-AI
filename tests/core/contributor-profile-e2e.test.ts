import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { CommunicationService } from '../../src/gateway/adapters/communication-service.js';
import { DeduplicationService } from '../../src/gateway/adapters/deduplication-service.js';
import { ConversationService } from '../../src/gateway/adapters/conversation-service.js';
import { IdentityService } from '../../src/gateway/adapters/identity-service.js';
import { MessagePersistenceService } from '../../src/gateway/adapters/message-persistence-service.js';
import { EventBus } from '../../src/gateway/event-bus.js';
import { Runtime as AgentRuntime } from '../../src/core/runtime.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';
import { db } from '../../src/db/client.js';
import { actors } from '../../src/db/schema/actors.js';

describe('WorkflowEngine records onboarding state (#22)', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('sets actors.onboardedAt after a contribution question is handled', async () => {
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
    const agentRuntime = new AgentRuntime({ demoMode: true });
    bus.subscribe(async (envelope) => {
      if (envelope.payload) await agentRuntime.processEvent(envelope);
    });

    const envelope = await commService.ingest(
      {
        id: `onboard_msg_${Date.now()}`,
        conversationId: `C_ONBOARD_${Date.now()}`,
        channel: 'slack',
        sender: { id: `U_ONBOARD_${Date.now()}`, username: 'newcontributor' },
        text: 'How can I start contributing to this project?',
      },
      'slack'
    );

    expect(replies).toHaveLength(1);
    const [actorRow] = await db
      .select()
      .from(actors)
      .where(eq(actors.id, envelope!.payload.actorId));
    expect(actorRow.onboardedAt).not.toBeNull();
  });
});
