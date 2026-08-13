import { beforeAll, describe, expect, it } from 'vitest';
import { CommunicationService } from '../../src/gateway/adapters/communication-service.js';
import { DeduplicationService } from '../../src/gateway/adapters/deduplication-service.js';
import { ConversationService } from '../../src/gateway/adapters/conversation-service.js';
import { IdentityService } from '../../src/gateway/adapters/identity-service.js';
import { MessagePersistenceService } from '../../src/gateway/adapters/message-persistence-service.js';
import { EventBus } from '../../src/gateway/event-bus.js';
import { Runtime as AgentRuntime } from '../../src/core/runtime.js';
import { MockLLMProvider } from '../../src/core/llm/llm-provider.js';
import { ingestRepositoryDocs } from '../../src/core/knowledge/ingestion-service.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';
import { fakeGitHubClient } from '../helpers/fixtures.js';

describe('General Q&A grounds its answer in ingested docs via real tool-calling (#10, #16)', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('calls search_documentation and reflects the retrieved content in the final reply', async () => {
    const owner = `ragowner_${Date.now()}`;
    const repo = 'ragrepo';

    const githubClient = fakeGitHubClient([], {
      docs: [
        {
          path: 'README.md',
          content: 'To deploy this project, run `pnpm run deploy` after building.',
        },
      ],
    });
    await ingestRepositoryDocs(owner, repo, githubClient, new MockLLMProvider());

    const bus = new EventBus();
    const replies: string[] = [];
    const commService = new CommunicationService(
      new DeduplicationService(),
      new ConversationService(),
      new IdentityService(),
      new MessagePersistenceService(),
      async (envelope) => {
        envelope.respond = async (text: string) => replies.push(text);
        await bus.publish(envelope as any);
      }
    );
    const agentRuntime = new AgentRuntime({ demoMode: true });
    bus.subscribe(async (envelope) => {
      if (envelope.payload) await agentRuntime.processEvent(envelope);
    });

    await commService.ingest(
      {
        id: `rag_msg_${Date.now()}`,
        conversationId: `C_RAG_${Date.now()}`,
        channel: 'github',
        sender: { id: 'U_RAG', username: 'asker' },
        text: 'What command do I run to deploy this project?',
        repositoryContext: { provider: 'github', owner, repositoryName: repo },
      },
      'github'
    );

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('pnpm run deploy');
  });
});
