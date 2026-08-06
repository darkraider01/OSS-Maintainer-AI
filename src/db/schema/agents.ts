import { pgTable, uuid, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { workflowTemplates } from './workflow_templates.js';

export const agents = pgTable('agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  promptReference: varchar('prompt_reference', { length: 1024 }).notNull(),
  promptVersion: varchar('prompt_version', { length: 50 }).notNull(),
  config: jsonb('config'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const agentsRelations = relations(agents, ({ many }) => ({
  workflowTemplates: many(workflowTemplates),
}));
