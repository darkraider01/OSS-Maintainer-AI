import { pgTable, uuid, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { workflowTemplates } from './workflow_templates.js';
import { executions } from './executions.js';

export const workflowVersions = pgTable('workflow_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  workflowTemplateId: uuid('workflow_template_id')
    .references(() => workflowTemplates.id, { onDelete: 'cascade' })
    .notNull(),
  versionTag: varchar('version_tag', { length: 50 }).notNull(),
  stepDefinitions: jsonb('step_definitions').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const workflowVersionsRelations = relations(workflowVersions, ({ one, many }) => ({
  template: one(workflowTemplates, {
    fields: [workflowVersions.workflowTemplateId],
    references: [workflowTemplates.id],
  }),
  executions: many(executions),
}));
