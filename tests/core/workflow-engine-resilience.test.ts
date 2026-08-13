import { beforeAll, describe, expect, it } from 'vitest';
import { CommunicationService } from '../../src/gateway/adapters/communication-service.js';
import { DeduplicationService } from '../../src/gateway/adapters/deduplication-service.js';
import { ConversationService } from '../../src/gateway/adapters/conversation-service.js';
import { IdentityService } from '../../src/gateway/adapters/identity-service.js';
import { MessagePersistenceService } from '../../src/gateway/adapters/message-persistence-service.js';
import { EventBus } from '../../src/gateway/event-bus.js';
import { Runtime as AgentRuntime } from '../../src/core/runtime.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';

describe('WorkflowEngine degrades gracefully when the agent throws (#27)', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('still sends a reply instead of silently dropping the event', async () => {
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

    const agentRuntime = new AgentRuntime({ demoMode: true });
    const agent = agentRuntime.agentRegistry.find('maintainer-agent')!;
    agent.execute = async () => {
      throw new Error('simulated unexpected failure (DB error, workflow bug, etc.)');
    };

    bus.subscribe(async (envelope) => {
      if (envelope.payload) await agentRuntime.processEvent(envelope);
    });

    await commService.ingest(
      {
        id: `resilience_msg_${Date.now()}`,
        conversationId: `C_RESILIENCE_${Date.now()}`,
        channel: 'slack',
        sender: { id: 'U_RES', username: 'reporter' },
        text: 'hello',
      },
      'slack'
    );

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('maintainer will follow up');
  });
});
