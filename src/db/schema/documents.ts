import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { knowledgeSources } from './knowledge_sources.js';
import { documentChunks } from './document_chunks.js';

export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  knowledgeSourceId: uuid('knowledge_source_id')
    .references(() => knowledgeSources.id, { onDelete: 'cascade' })
    .notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  checksum: varchar('checksum', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const documentsRelations = relations(documents, ({ one, many }) => ({
  knowledgeSource: one(knowledgeSources, {
    fields: [documents.knowledgeSourceId],
    references: [knowledgeSources.id],
  }),
  chunks: many(documentChunks),
}));
