import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { workflowVersions } from './workflow_versions.js';
import { conversations } from './conversations.js';
import { executionStatusEnum } from './enums.js';
import { executionEvents } from './execution_events.js';
import { toolCalls } from './tool_calls.js';
import { executionArtifacts } from './execution_artifacts.js';

export const executions = pgTable('executions', {
  id: uuid('id').defaultRandom().primaryKey(),
  workflowVersionId: uuid('workflow_version_id')
    .references(() => workflowVersions.id, { onDelete: 'cascade' })
    .notNull(),
  conversationId: uuid('conversation_id')
    .references(() => conversations.id, { onDelete: 'cascade' })
    .notNull(),
  status: executionStatusEnum('status').default('idle').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const executionsRelations = relations(executions, ({ one, many }) => ({
  workflowVersion: one(workflowVersions, {
    fields: [executions.workflowVersionId],
    references: [workflowVersions.id],
  }),
  conversation: one(conversations, {
    fields: [executions.conversationId],
    references: [conversations.id],
  }),
  events: many(executionEvents),
  toolCalls: many(toolCalls),
  artifacts: many(executionArtifacts),
}));
