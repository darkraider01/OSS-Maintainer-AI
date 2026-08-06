import { pgTable, uuid, varchar, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { repositories } from './repositories.js';
import { providerEnum } from './enums.js';

export const repositoryIntegrations = pgTable(
  'repository_integrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .references(() => repositories.id, { onDelete: 'cascade' })
      .notNull(),
    provider: providerEnum('provider').notNull(),
    externalRepositoryId: varchar('external_repository_id', { length: 255 }).notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('repo_integrations_provider_idx').on(table.provider, table.externalRepositoryId),
  ]
);

export const repositoryIntegrationsRelations = relations(repositoryIntegrations, ({ one }) => ({
  repository: one(repositories, {
    fields: [repositoryIntegrations.repositoryId],
    references: [repositories.id],
  }),
}));
