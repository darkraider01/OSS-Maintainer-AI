import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { repositories } from '../../db/schema/repositories.js';
import { knowledgeSources } from '../../db/schema/knowledge_sources.js';
import { documents } from '../../db/schema/documents.js';
import { documentChunks } from '../../db/schema/document_chunks.js';
import { embeddings } from '../../db/schema/embeddings.js';
import type { LLMProvider } from '../llm/llm-provider.js';

export interface DocSearchResult {
  path: string;
  content: string;
  score: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

/**
 * Semantic retrieval for documentation QA (#10). Computes cosine similarity
 * in application code rather than a pgvector SQL query — the same vector
 * column already has to work as plain TEXT under SQLite (see
 * src/db/schema/embeddings.ts), so an in-app comparison is the one path
 * that's portable across both dialects without a pgvector-only query.
 * Fine at this app's scale (a repo's docs are at most a few hundred chunks).
 */
export async function searchDocumentation(
  owner: string,
  repo: string,
  query: string,
  llmProvider: LLMProvider,
  topK = 3
): Promise<DocSearchResult[]> {
  if (!query.trim()) return [];

  const url = `https://github.com/${owner}/${repo}`;
  const [repository] = await db.select().from(repositories).where(eq(repositories.url, url));
  if (!repository) return [];

  const rows = await db
    .select({
      path: documents.title,
      content: documentChunks.content,
      vector: embeddings.vector,
    })
    .from(embeddings)
    .innerJoin(documentChunks, eq(embeddings.documentChunkId, documentChunks.id))
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .innerJoin(knowledgeSources, eq(documents.knowledgeSourceId, knowledgeSources.id))
    .where(eq(knowledgeSources.repositoryId, repository.id));

  if (rows.length === 0) return [];

  const queryEmbedding = await llmProvider.embed(query);

  return (rows as any[])
    .map((row) => ({
      path: row.path as string,
      content: row.content as string,
      score: cosineSimilarity(queryEmbedding.vector, row.vector as number[]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
