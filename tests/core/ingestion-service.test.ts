import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ingestRepositoryDocs } from '../../src/core/knowledge/ingestion-service.js';
import { MockLLMProvider } from '../../src/core/llm/llm-provider.js';
import { db } from '../../src/db/client.js';
import { repositories } from '../../src/db/schema/repositories.js';
import { knowledgeSources } from '../../src/db/schema/knowledge_sources.js';
import { documents } from '../../src/db/schema/documents.js';
import { documentChunks } from '../../src/db/schema/document_chunks.js';
import { embeddings } from '../../src/db/schema/embeddings.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';
import { fakeGitHubClient } from '../helpers/fixtures.js';

describe('ingestRepositoryDocs', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('ingests README content into knowledge_sources/documents/document_chunks/embeddings', async () => {
    const owner = 'darkraider01';
    const repo = `ingest-test-${Date.now()}`;
    const client = fakeGitHubClient([], {
      docs: [{ path: 'README.md', content: 'Hello world.\n\nThis is a test repo.' }],
    });
    const llm = new MockLLMProvider();

    const result = await ingestRepositoryDocs(owner, repo, client, llm);

    expect(result.documentsProcessed).toBe(1);
    expect(result.documentsSkipped).toBe(0);
    expect(result.chunksEmbedded).toBeGreaterThan(0);

    const [repository] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.url, `https://github.com/${owner}/${repo}`));
    expect(repository).toBeDefined();

    const [source] = await db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.repositoryId, repository.id));
    expect(source.pathOrUrl).toBe('README.md');

    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.knowledgeSourceId, source.id));
    expect(document.title).toBe('README.md');

    const chunks = await db
      .select()
      .from(documentChunks)
      .where(eq(documentChunks.documentId, document.id));
    expect(chunks.length).toBeGreaterThan(0);

    const [embeddingRow] = await db
      .select()
      .from(embeddings)
      .where(eq(embeddings.documentChunkId, chunks[0].id));
    expect(embeddingRow.vector).toHaveLength(1536);
    expect(embeddingRow.provider).toBe('mock-llm');
  });

  it('is idempotent: re-running with unchanged content skips re-embedding', async () => {
    const owner = 'darkraider01';
    const repo = `ingest-idempotent-${Date.now()}`;
    const content = 'Stable content that never changes.';
    const client = fakeGitHubClient([], { docs: [{ path: 'README.md', content }] });
    const llm = new MockLLMProvider();

    const first = await ingestRepositoryDocs(owner, repo, client, llm);
    const second = await ingestRepositoryDocs(owner, repo, client, llm);

    expect(first.documentsProcessed).toBe(1);
    expect(second.documentsProcessed).toBe(0);
    expect(second.documentsSkipped).toBe(1);
    expect(second.chunksEmbedded).toBe(0);
  });

  it('re-embeds when document content changes between runs', async () => {
    const owner = 'darkraider01';
    const repo = `ingest-changed-${Date.now()}`;
    const llm = new MockLLMProvider();

    const clientV1 = fakeGitHubClient([], {
      docs: [{ path: 'README.md', content: 'Version one of the content.' }],
    });
    const firstRun = await ingestRepositoryDocs(owner, repo, clientV1, llm);
    expect(firstRun.documentsProcessed).toBe(1);

    const clientV2 = fakeGitHubClient([], {
      docs: [{ path: 'README.md', content: 'Version two — completely different content now.' }],
    });
    const secondRun = await ingestRepositoryDocs(owner, repo, clientV2, llm);

    expect(secondRun.documentsProcessed).toBe(1);
    expect(secondRun.documentsSkipped).toBe(0);
    expect(secondRun.chunksEmbedded).toBeGreaterThan(0);

    const [repository] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.url, `https://github.com/${owner}/${repo}`));
    const [source] = await db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.repositoryId, repository.id));
    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.knowledgeSourceId, source.id));
    const chunks = await db
      .select()
      .from(documentChunks)
      .where(eq(documentChunks.documentId, document.id));
    expect(chunks[0].content).toContain('Version two');
  });
});
