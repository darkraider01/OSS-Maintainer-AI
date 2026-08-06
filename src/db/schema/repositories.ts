import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { repositoryIntegrations } from './repository_integrations.js';
import { conversations } from './conversations.js';
import { knowledgeSources } from './knowledge_sources.js';

export const repositories = pgTable('repositories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  url: varchar('url', { length: 2048 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const repositoriesRelations = relations(repositories, ({ many }) => ({
  integrations: many(repositoryIntegrations),
  conversations: many(conversations),
  knowledgeSources: many(knowledgeSources),
}));
