import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { actorTypeEnum } from './enums.js';
import { actorAccounts } from './actor_accounts.js';
import { messages } from './messages.js';
import { memories } from './memories.js';

export const actors = pgTable('actors', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: actorTypeEnum('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  /** Last time OnboardingWorkflow ran for this actor — feeds the contributor profile's onboarding state. */
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
});

export const actorsRelations = relations(actors, ({ many }) => ({
  accounts: many(actorAccounts),
  messages: many(messages),
  memories: many(memories),
}));
