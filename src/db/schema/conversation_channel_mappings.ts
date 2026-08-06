import { pgTable, uuid, varchar, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { conversations } from './conversations.js';
import { providerEnum } from './enums.js';

export const conversationChannelMappings = pgTable(
  'conversation_channel_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .references(() => conversations.id, { onDelete: 'cascade' })
      .notNull(),
    provider: providerEnum('provider').notNull(),
    channelType: varchar('channel_type', { length: 50 }).notNull(),
    externalThreadId: varchar('external_thread_id', { length: 255 }).notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('conv_channel_mappings_idx').on(
      table.provider,
      table.channelType,
      table.externalThreadId
    ),
  ]
);

export const conversationChannelMappingsRelations = relations(
  conversationChannelMappings,
  ({ one }) => ({
    conversation: one(conversations, {
      fields: [conversationChannelMappings.conversationId],
      references: [conversations.id],
    }),
  })
);
