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
import { messages } from '../../src/db/schema/messages.js';
import { actors } from '../../src/db/schema/actors.js';

describe('WorkflowEngine persists the agent\'s own reply, not just the inbound message', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('writes a second `messages` row (actor type "agent") for the reply after handling a turn', async () => {
    // Regression: previously WorkflowEngine only ever called
    // MessagePersistenceService.persist() for the *inbound* event — the
    // agent's own reply was sent via envelope.respond() and never written
    // to `messages` at all, so same-conversation memory and cross-channel
    // history only ever contained the human's side of the exchange.
    const bus = new EventBus();
    const commService = new CommunicationService(
      new DeduplicationService(),
      new ConversationService(),
      new IdentityService(),
      new MessagePersistenceService(),
      async (envelope) => {
        envelope.respond = async () => {};
        await bus.publish(envelope as any);
      }
    );
    const agentRuntime = new AgentRuntime({ demoMode: true });
    bus.subscribe(async (envelope) => {
      if (envelope.payload) await agentRuntime.processEvent(envelope);
    });

    const conversationId = `C_MEMORY_${Date.now()}`;
    const envelope = await commService.ingest(
      {
        id: `memory_msg_${Date.now()}`,
        conversationId,
        channel: 'slack',
        sender: { id: 'U_MEMORY', username: 'reporter' },
        text: 'my name is ishan',
      },
      'slack'
    );
    expect(envelope).not.toBeNull();

    const rows = await db
      .select({ content: messages.content, actorType: actors.type })
      .from(messages)
      .innerJoin(actors, eq(messages.senderActorId, actors.id))
      .where(eq(messages.conversationId, envelope!.payload.conversationId));

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.actorType === 'human')?.content).toBe('my name is ishan');
    const agentRow = rows.find((r) => r.actorType === 'agent');
    expect(agentRow).toBeDefined();
    expect(agentRow!.content.length).toBeGreaterThan(0);
  });

  it('accumulates both sides across multiple turns in the same conversation', async () => {
    const bus = new EventBus();
    const commService = new CommunicationService(
      new DeduplicationService(),
      new ConversationService(),
      new IdentityService(),
      new MessagePersistenceService(),
      async (envelope) => {
        envelope.respond = async () => {};
        await bus.publish(envelope as any);
      }
    );
    const agentRuntime = new AgentRuntime({ demoMode: true });
    bus.subscribe(async (envelope) => {
      if (envelope.payload) await agentRuntime.processEvent(envelope);
    });

    const conversationId = `C_MEMORY_MULTI_${Date.now()}`;
    const senderId = `U_MEMORY_MULTI_${Date.now()}`;

    const first = await commService.ingest(
      { id: `mm1_${Date.now()}`, conversationId, channel: 'slack', sender: { id: senderId, username: 'reporter' }, text: 'first message' },
      'slack'
    );
    const second = await commService.ingest(
      { id: `mm2_${Date.now()}`, conversationId, channel: 'slack', sender: { id: senderId, username: 'reporter' }, text: 'second message' },
      'slack'
    );
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    const rows = await db
      .select({ actorType: actors.type })
      .from(messages)
      .innerJoin(actors, eq(messages.senderActorId, actors.id))
      .where(eq(messages.conversationId, first!.payload.conversationId));

    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.actorType === 'human')).toHaveLength(2);
    expect(rows.filter((r) => r.actorType === 'agent')).toHaveLength(2);
  });
});
