import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { db } from '../../src/db/client.js';
import { repositories } from '../../src/db/schema/repositories.js';
import { knowledgeSources } from '../../src/db/schema/knowledge_sources.js';
import { documents } from '../../src/db/schema/documents.js';
import { documentChunks } from '../../src/db/schema/document_chunks.js';
import { embeddings } from '../../src/db/schema/embeddings.js';
import { SearchDocumentationTool } from '../../src/core/tools/search-documentation-tool.js';
import { MockLLMProvider } from '../../src/core/llm/llm-provider.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';
import type { AgentContext } from '../../src/core/agent/agent-types.js';

const llm = new MockLLMProvider();
const tool = new SearchDocumentationTool();

function fakeContext(repositoryContext?: AgentContext['repositoryContext']): AgentContext {
  return { repositoryContext, llm } as AgentContext;
}

describe('SearchDocumentationTool', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('returns an explicit note (not an error) when there is no repository context', async () => {
    const result = (await tool.execute({ query: 'anything' }, fakeContext(undefined))) as any;
    expect(result.results).toEqual([]);
    expect(result.note).toMatch(/no repository context/i);
  });

  it('returns an explicit note when the repository has never been ingested', async () => {
    const result = (await tool.execute(
      { query: 'anything' },
      fakeContext({ provider: 'github', owner: 'never-ingested', repositoryName: 'repo' })
    )) as any;
    expect(result.results).toEqual([]);
    expect(result.note).toMatch(/no ingested documentation/i);
  });

  it('returns real, grounded results when the repository has ingested docs', async () => {
    const owner = `owner_${Date.now()}`;
    const repo = 'repo';
    const now = new Date();

    const repositoryId = randomUUID();
    await db.insert(repositories).values({
      id: repositoryId,
      name: `${owner}/${repo}`,
      url: `https://github.com/${owner}/${repo}`,
      createdAt: now,
      updatedAt: now,
    });
    const knowledgeSourceId = randomUUID();
    await db.insert(knowledgeSources).values({
      id: knowledgeSourceId,
      repositoryId,
      type: 'doc',
      pathOrUrl: 'README.md',
      createdAt: now,
      updatedAt: now,
    });
    const documentId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      knowledgeSourceId,
      title: 'README.md',
      checksum: 'c',
      createdAt: now,
      updatedAt: now,
    });
    const chunkId = randomUUID();
    await db.insert(documentChunks).values({
      id: chunkId,
      documentId,
      content: 'Install with pnpm install, then run pnpm dev.',
      sequenceOrder: 0,
      chunkIndex: 0,
      tokenCount: 8,
      checksum: 'cc',
      createdAt: now,
    });
    const embedding = await llm.embed('Install with pnpm install, then run pnpm dev.');
    await db.insert(embeddings).values({
      id: randomUUID(),
      documentChunkId: chunkId,
      vector: embedding.vector,
      chunkHash: 'cc',
      embeddingModel: embedding.model,
      provider: llm.name,
      dimension: embedding.dimension,
      tokenCount: 8,
      checksum: 'cc',
      createdAt: now,
    });

    const result = (await tool.execute(
      { query: 'how do I install' },
      fakeContext({ provider: 'github', owner, repositoryName: repo })
    )) as any;

    expect(result.results).toHaveLength(1);
    expect(result.results[0].path).toBe('README.md');
    expect(result.results[0].excerpt).toContain('pnpm dev');
  });
});
