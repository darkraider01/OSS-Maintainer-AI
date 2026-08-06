import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { repositories } from './repositories.js';
import { knowledgeSourceTypeEnum } from './enums.js';
import { documents } from './documents.js';

export const knowledgeSources = pgTable('knowledge_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  repositoryId: uuid('repository_id').references(() => repositories.id, { onDelete: 'cascade' }),
  type: knowledgeSourceTypeEnum('type').notNull(),
  pathOrUrl: varchar('path_or_url', { length: 2048 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const knowledgeSourcesRelations = relations(knowledgeSources, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [knowledgeSources.repositoryId],
    references: [repositories.id],
  }),
  documents: many(documents),
}));
