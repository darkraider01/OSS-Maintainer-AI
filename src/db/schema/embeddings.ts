import { pgTable, uuid, customType, varchar, integer, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { memoryChunks } from './memory_chunks.js';
import { documentChunks } from './document_chunks.js';

// Custom type wrapper mapping pgvector bindings
const pgVectorType = customType<{ data: number[] }>({
  dataType() {
    return 'vector(1536)';
  },
});

export const embeddings = pgTable('embeddings', {
  id: uuid('id').defaultRandom().primaryKey(),
  memoryChunkId: uuid('memory_chunk_id').references(() => memoryChunks.id, { onDelete: 'cascade' }),
  documentChunkId: uuid('document_chunk_id').references(() => documentChunks.id, {
    onDelete: 'cascade',
  }),
  vector: pgVectorType('vector').notNull(),
  chunkHash: varchar('chunk_hash', { length: 64 }).notNull(),
  embeddingModel: varchar('embedding_model', { length: 255 }).notNull(),
  provider: varchar('provider', { length: 100 }).notNull(),
  dimension: integer('dimension').notNull(),
  tokenCount: integer('token_count').notNull(),
  checksum: varchar('checksum', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const embeddingsRelations = relations(embeddings, ({ one }) => ({
  memoryChunk: one(memoryChunks, {
    fields: [embeddings.memoryChunkId],
    references: [memoryChunks.id],
  }),
  documentChunk: one(documentChunks, {
    fields: [embeddings.documentChunkId],
    references: [documentChunks.id],
  }),
}));
