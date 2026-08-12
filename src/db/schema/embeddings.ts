import { pgTable, uuid, customType, varchar, integer, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { memoryChunks } from './memory_chunks.js';
import { documentChunks } from './document_chunks.js';

// Custom type wrapper mapping pgvector bindings. `toDriver`/`fromDriver` serialize
// as JSON array syntax, which doubles as pgvector's own textual literal format
// (`[1,2,3]`) — works unmodified under real pgvector *and* as plain SQLite TEXT.
const pgVectorType = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return JSON.stringify(value);
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value);
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
