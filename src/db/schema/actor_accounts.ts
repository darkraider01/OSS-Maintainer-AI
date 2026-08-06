import { pgTable, uuid, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { actors } from './actors.js';
import { providerEnum } from './enums.js';

export const actorAccounts = pgTable(
  'actor_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorId: uuid('actor_id')
      .references(() => actors.id, { onDelete: 'cascade' })
      .notNull(),
    provider: providerEnum('provider').notNull(),
    providerUserId: varchar('provider_user_id', { length: 255 }).notNull(),
    username: varchar('username', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }),
    avatarUrl: varchar('avatar_url', { length: 2048 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('actor_accounts_provider_user_idx').on(table.provider, table.providerUserId),
  ]
);

export const actorAccountsRelations = relations(actorAccounts, ({ one }) => ({
  actor: one(actors, {
    fields: [actorAccounts.actorId],
    references: [actors.id],
  }),
}));
