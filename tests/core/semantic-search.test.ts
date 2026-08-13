import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { db } from '../../src/db/client.js';
import { repositories } from '../../src/db/schema/repositories.js';
import { knowledgeSources } from '../../src/db/schema/knowledge_sources.js';
import { documents } from '../../src/db/schema/documents.js';
import { documentChunks } from '../../src/db/schema/document_chunks.js';
import { embeddings } from '../../src/db/schema/embeddings.js';
import { searchDocumentation } from '../../src/core/knowledge/semantic-search.js';
import { MockLLMProvider } from '../../src/core/llm/llm-provider.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';

const llm = new MockLLMProvider();

const repositoryIdByUrl = new Map<string, string>();

async function ensureRepository(owner: string, repo: string): Promise<string> {
  const url = `https://github.com/${owner}/${repo}`;
  const existing = repositoryIdByUrl.get(url);
  if (existing) return existing;

  const now = new Date();
  const repositoryId = randomUUID();
  await db
    .insert(repositories)
    .values({ id: repositoryId, name: `${owner}/${repo}`, url, createdAt: now, updatedAt: now });
  repositoryIdByUrl.set(url, repositoryId);
  return repositoryId;
}

async function seedRepoWithChunk(owner: string, repo: string, path: string, content: string) {
  const now = new Date();
  const repositoryId = await ensureRepository(owner, repo);

  const knowledgeSourceId = randomUUID();
  await db.insert(knowledgeSources).values({
    id: knowledgeSourceId,
    repositoryId,
    type: 'doc',
    pathOrUrl: path,
    createdAt: now,
    updatedAt: now,
  });

  const documentId = randomUUID();
  await db.insert(documents).values({
    id: documentId,
    knowledgeSourceId,
    title: path,
    checksum: 'checksum',
    createdAt: now,
    updatedAt: now,
  });

  const chunkId = randomUUID();
  await db.insert(documentChunks).values({
    id: chunkId,
    documentId,
    content,
    sequenceOrder: 0,
    chunkIndex: 0,
    tokenCount: content.split(' ').length,
    checksum: 'chunk-checksum',
    createdAt: now,
  });

  const embedding = await llm.embed(content);
  await db.insert(embeddings).values({
    id: randomUUID(),
    documentChunkId: chunkId,
    vector: embedding.vector,
    chunkHash: 'chunk-checksum',
    embeddingModel: embedding.model,
    provider: llm.name,
    dimension: embedding.dimension,
    tokenCount: content.split(' ').length,
    checksum: 'chunk-checksum',
    createdAt: now,
  });
}

describe('searchDocumentation (#10)', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('returns the ingested chunk most similar to the query', async () => {
    const owner = `owner_${Date.now()}`;
    const repo = 'repo1';
    await seedRepoWithChunk(
      owner,
      repo,
      'README.md',
      'Run pnpm install then pnpm dev to start the server.'
    );

    const results = await searchDocumentation(owner, repo, 'how do I run the dev server', llm, 3);

    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('README.md');
    expect(results[0].content).toContain('pnpm dev');
    expect(results[0].score).toBeGreaterThan(-1);
    expect(results[0].score).toBeLessThanOrEqual(1);
  });

  it('returns an empty array for a repository that was never ingested', async () => {
    const results = await searchDocumentation(
      'nonexistent-owner',
      'nonexistent-repo',
      'anything',
      llm
    );
    expect(results).toEqual([]);
  });

  it('returns an empty array for an empty query rather than erroring', async () => {
    const owner = `owner_${Date.now()}_2`;
    await seedRepoWithChunk(owner, 'repo2', 'README.md', 'content');
    const results = await searchDocumentation(owner, 'repo2', '', llm);
    expect(results).toEqual([]);
  });

  it('returns results sorted by descending similarity score and respects topK', async () => {
    const owner = `owner_${Date.now()}_3`;
    const repo = 'repo3';
    await seedRepoWithChunk(owner, repo, 'A.md', 'chunk content a');
    await seedRepoWithChunk(owner, repo, 'B.md', 'chunk content b');
    await seedRepoWithChunk(owner, repo, 'C.md', 'chunk content c');

    const results = await searchDocumentation(owner, repo, 'a query', llm, 2);
    expect(results).toHaveLength(2);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });
});
