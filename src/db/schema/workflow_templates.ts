import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { agents } from './agents.js';
import { workflowVersions } from './workflow_versions.js';

export const workflowTemplates = pgTable('workflow_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  triggerAgentId: uuid('trigger_agent_id')
    .references(() => agents.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const workflowTemplatesRelations = relations(workflowTemplates, ({ one, many }) => ({
  triggerAgent: one(agents, {
    fields: [workflowTemplates.triggerAgentId],
    references: [agents.id],
  }),
  versions: many(workflowVersions),
}));
