import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
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
