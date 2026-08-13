import { pgTable, uuid, timestamp, varchar, integer, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { repositories } from './repositories.js';
import { conversationChannelMappings } from './conversation_channel_mappings.js';
import { messages } from './messages.js';
import { executions } from './executions.js';
import { memories } from './memories.js';

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  repositoryId: uuid('repository_id').references(() => repositories.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  /** Non-null once a human has taken over — blocks further autonomous agent replies. */
  escalatedAt: timestamp('escalated_at', { withTimezone: true }),
  escalationReason: varchar('escalation_reason', { length: 50 }),
  /** Consecutive low-confidence/unresolved agent turns; feeds the repeated-failure escalation trigger. */
  failureStreak: integer('failure_streak').default(0).notNull(),
  /** In-flight `IssueTriageState` (multi-turn missing-field collection), cleared once triage completes. */
  triageState: jsonb('triage_state'),
});

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [conversations.repositoryId],
    references: [repositories.id],
  }),
  channelMappings: many(conversationChannelMappings),
  messages: many(messages),
  executions: many(executions),
  memories: many(memories),
}));
