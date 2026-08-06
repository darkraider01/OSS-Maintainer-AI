import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { conversations } from './conversations.js';
import { actors } from './actors.js';
import { memoryScopeEnum } from './enums.js';
import { memoryChunks } from './memory_chunks.js';

export const memories = pgTable('memories', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').references(() => conversations.id, {
    onDelete: 'cascade',
  }),
  actorId: uuid('actor_id').references(() => actors.id, { onDelete: 'cascade' }),
  scope: memoryScopeEnum('scope').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const memoriesRelations = relations(memories, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [memories.conversationId],
    references: [conversations.id],
  }),
  actor: one(actors, {
    fields: [memories.actorId],
    references: [actors.id],
  }),
  chunks: many(memoryChunks),
}));
