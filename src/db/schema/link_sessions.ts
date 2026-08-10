import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { actors } from './actors.js';

/**
 * A short-lived browser session for the account-linking dashboard. `id` is
 * the opaque session token itself (set as an httpOnly cookie), not a
 * surrogate key — there is nothing else to look it up by. `actorId` is null
 * until the first provider is linked in this session; every subsequent
 * provider linked in the same session merges into that actor.
 */
export const linkSessions = pgTable('link_sessions', {
  id: text('id').primaryKey(),
  actorId: uuid('actor_id').references(() => actors.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const linkSessionsRelations = relations(linkSessions, ({ one }) => ({
  actor: one(actors, {
    fields: [linkSessions.actorId],
    references: [actors.id],
  }),
}));
