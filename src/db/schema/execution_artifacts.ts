import { pgTable, uuid, varchar, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { executions } from './executions.js';
import { artifactTypeEnum } from './enums.js';

export const executionArtifacts = pgTable('execution_artifacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  executionId: uuid('execution_id')
    .references(() => executions.id, { onDelete: 'cascade' })
    .notNull(),
  type: artifactTypeEnum('type').notNull(),
  contentType: varchar('content_type', { length: 100 }).notNull(), // mime-type e.g. text/markdown
  content: text('content').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const executionArtifactsRelations = relations(executionArtifacts, ({ one }) => ({
  execution: one(executions, {
    fields: [executionArtifacts.executionId],
    references: [executions.id],
  }),
}));
