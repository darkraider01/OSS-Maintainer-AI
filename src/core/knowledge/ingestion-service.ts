import { randomUUID, createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { repositories } from '../../db/schema/repositories.js';
import { knowledgeSources } from '../../db/schema/knowledge_sources.js';
import { documents } from '../../db/schema/documents.js';
import { documentChunks } from '../../db/schema/document_chunks.js';
import { embeddings } from '../../db/schema/embeddings.js';
import { logger } from '../../config/logger.js';
import { chunkText } from './chunker.js';
import type { GitHubClientLike } from '../../gateway/github/client.js';
import type { LLMProvider } from '../llm/llm-provider.js';

export interface IngestionResult {
  owner: string;
  repo: string;
  documentsProcessed: number;
  documentsSkipped: number;
  chunksEmbedded: number;
}

function checksumOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function resolveRepository(owner: string, repo: string): Promise<string> {
  const url = `https://github.com/${owner}/${repo}`;
  const [existing] = await db.select().from(repositories).where(eq(repositories.url, url));
  if (existing) return existing.id;

  const now = new Date();
  const [created] = await db
    .insert(repositories)
    .values({ id: randomUUID(), name: `${owner}/${repo}`, url, createdAt: now, updatedAt: now })
    .returning();
  return created.id;
}

async function resolveKnowledgeSource(repositoryId: string, pathOrUrl: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.repositoryId, repositoryId),
        eq(knowledgeSources.pathOrUrl, pathOrUrl)
      )
    );
  if (existing) return existing.id;

  const now = new Date();
  const [created] = await db
    .insert(knowledgeSources)
    .values({
      id: randomUUID(),
      repositoryId,
      type: 'doc',
      pathOrUrl,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created.id;
}

/** Deletes a document's existing chunks and their embeddings before re-chunking changed content. */
async function clearStaleChunks(documentId: string): Promise<void> {
  const staleChunks = await db
    .select({ id: documentChunks.id })
    .from(documentChunks)
    .where(eq(documentChunks.documentId, documentId));
  for (const chunk of staleChunks) {
    await db.delete(embeddings).where(eq(embeddings.documentChunkId, chunk.id));
  }
  await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
}

/**
 * Pulls README + `/docs` from a GitHub repo, chunks each document, embeds every
 * chunk, and upserts the result into `knowledge_sources`/`documents`/
 * `document_chunks`/`embeddings`. Idempotent: a document whose content checksum
 * hasn't changed since the last run is skipped entirely (no re-chunk, no
 * re-embed, no API calls) — safe to re-run on a schedule or after every push.
 */
export async function ingestRepositoryDocs(
  owner: string,
  repo: string,
  githubClient: GitHubClientLike,
  llmProvider: LLMProvider
): Promise<IngestionResult> {
  const log = logger.child({ owner, repo });
  const repositoryId = await resolveRepository(owner, repo);
  const docs = await githubClient.getRepositoryDocs(owner, repo);

  let documentsProcessed = 0;
  let documentsSkipped = 0;
  let chunksEmbedded = 0;

  for (const doc of docs) {
    if (!doc.content.trim()) continue;

    const checksum = checksumOf(doc.content);
    const knowledgeSourceId = await resolveKnowledgeSource(repositoryId, doc.path);

    const [existingDocument] = await db
      .select()
      .from(documents)
      .where(eq(documents.knowledgeSourceId, knowledgeSourceId));

    if (existingDocument && existingDocument.checksum === checksum) {
      documentsSkipped += 1;
      log.debug({ path: doc.path }, 'Document unchanged, skipping re-ingestion');
      continue;
    }

    const now = new Date();
    let documentId: string;
    if (existingDocument) {
      documentId = existingDocument.id;
      await db
        .update(documents)
        .set({ checksum, updatedAt: now })
        .where(eq(documents.id, documentId));
      await clearStaleChunks(documentId);
    } else {
      const [created] = await db
        .insert(documents)
        .values({
          id: randomUUID(),
          knowledgeSourceId,
          title: doc.path,
          checksum,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      documentId = created.id;
    }

    const chunks = chunkText(doc.content);
    for (const chunk of chunks) {
      const [insertedChunk] = await db
        .insert(documentChunks)
        .values({
          id: randomUUID(),
          documentId,
          content: chunk.content,
          sequenceOrder: chunk.sequenceOrder,
          chunkIndex: chunk.chunkIndex,
          tokenCount: chunk.tokenCount,
          checksum: chunk.checksum,
          createdAt: now,
        })
        .returning();

      const embedding = await llmProvider.embed(chunk.content);
      await db.insert(embeddings).values({
        id: randomUUID(),
        documentChunkId: insertedChunk.id,
        vector: embedding.vector,
        chunkHash: chunk.checksum,
        embeddingModel: embedding.model,
        provider: llmProvider.name,
        dimension: embedding.dimension,
        tokenCount: chunk.tokenCount,
        checksum: chunk.checksum,
        createdAt: now,
      });
      chunksEmbedded += 1;
    }

    documentsProcessed += 1;
    log.info({ path: doc.path, chunks: chunks.length }, 'Ingested document');
  }

  return { owner, repo, documentsProcessed, documentsSkipped, chunksEmbedded };
}
