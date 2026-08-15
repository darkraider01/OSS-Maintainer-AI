import { beforeAll, describe, expect, it, vi } from 'vitest';
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

  it('labels cross-channel history with the real provider of the other conversation, not its raw UUID', async () => {
    // Regression: WorkflowEngine's crossChannelHistory only ever carried
    // the internal `conversationId` (a UUID), and PromptBuilder tried to
    // derive a platform label from it via `conversationId.split(':')[0]` —
    // which just produced the UUID itself, since there's no colon to split
    // on. The actual provider (github/slack/discord) was never threaded
    // through at all.
    //
    // A shared actor across providers only exists once identities are
    // explicitly linked (the same "connected profiles" mechanism the real
    // account-linking dashboard uses) — using the same raw sender id on two
    // different providers does *not* imply the same person on its own.
    const identityService = new IdentityService();
    const bus = new EventBus();
    const commService = new CommunicationService(
      new DeduplicationService(),
      new ConversationService(),
      identityService,
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

    const githubUserId = `U_XCHAN_GH_${Date.now()}`;
    const slackUserId = `U_XCHAN_SLACK_${Date.now()}`;
    const sharedActorId = await identityService.resolveActor({
      provider: 'github',
      providerUserId: githubUserId,
      username: 'reporter',
    });
    await identityService.linkProviderToActor(sharedActorId, {
      provider: 'slack',
      providerUserId: slackUserId,
      username: 'reporter',
    });

    // First turn on GitHub, in its own conversation.
    await commService.ingest(
      {
        id: `xchan_gh_${Date.now()}`,
        conversationId: `C_XCHAN_GH_${Date.now()}`,
        channel: 'github',
        sender: { id: githubUserId, login: 'reporter' },
        text: 'a github message',
      },
      'github'
    );

    // Second turn, same (now-linked) actor, on Slack in a different
    // conversation — this is the one whose prompt should include
    // cross-channel context from GitHub.
    const buildSpy = vi.spyOn(agentRuntime.promptBuilder, 'build');
    await commService.ingest(
      {
        id: `xchan_slack_${Date.now()}`,
        conversationId: `C_XCHAN_SLACK_${Date.now()}`,
        channel: 'slack',
        sender: { id: slackUserId, username: 'reporter' },
        text: 'a slack message',
      },
      'slack'
    );

    expect(buildSpy).toHaveBeenCalledOnce();
    const crossChannelHistoryArg = buildSpy.mock.calls[0][6] as Array<{ provider: string }>;
    expect(crossChannelHistoryArg.length).toBeGreaterThan(0);
    expect(crossChannelHistoryArg.every((m) => m.provider === 'github')).toBe(true);
  });
});
