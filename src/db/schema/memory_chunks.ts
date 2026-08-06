import { pgTable, uuid, text, integer, varchar, real, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { memories } from './memories.js';
import { embeddings } from './embeddings.js';

export const memoryChunks = pgTable('memory_chunks', {
  id: uuid('id').defaultRandom().primaryKey(),
  memoryId: uuid('memory_id')
    .references(() => memories.id, { onDelete: 'cascade' })
    .notNull(),
  content: text('content').notNull(),
  tokenCount: integer('token_count').notNull(),
  checksum: varchar('checksum', { length: 64 }).notNull(),
  importanceScore: real('importance_score').default(1.0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const memoryChunksRelations = relations(memoryChunks, ({ one }) => ({
  memory: one(memories, {
    fields: [memoryChunks.memoryId],
    references: [memories.id],
  }),
  embeddings: one(embeddings),
}));
