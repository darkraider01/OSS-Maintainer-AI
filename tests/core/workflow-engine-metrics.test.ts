import { beforeAll, describe, expect, it } from 'vitest';
import { CommunicationService } from '../../src/gateway/adapters/communication-service.js';
import { DeduplicationService } from '../../src/gateway/adapters/deduplication-service.js';
import { ConversationService } from '../../src/gateway/adapters/conversation-service.js';
import { IdentityService } from '../../src/gateway/adapters/identity-service.js';
import { MessagePersistenceService } from '../../src/gateway/adapters/message-persistence-service.js';
import { EventBus } from '../../src/gateway/event-bus.js';
import { Runtime as AgentRuntime } from '../../src/core/runtime.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';
import { metrics } from '../../src/core/observability/metrics.js';

describe('WorkflowEngine emits execution metrics (#25)', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('records agent_executions_total and events_processed_total for a normal turn', async () => {
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

    await commService.ingest(
      {
        id: `metrics_msg_${Date.now()}`,
        conversationId: `C_METRICS_${Date.now()}`,
        channel: 'slack',
        sender: { id: 'U_METRICS', username: 'reporter' },
        text: 'a perfectly ordinary question',
      },
      'slack'
    );

    const executionsOutput = metrics.agentExecutionsTotal.render();
    expect(executionsOutput).toContain('workflow="general-workflow"');

    const processedOutput = metrics.eventsProcessedTotal.render();
    expect(processedOutput).toContain('provider="slack"');
  });
});
