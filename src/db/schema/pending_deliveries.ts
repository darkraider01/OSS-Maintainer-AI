import { pgTable, uuid, text, jsonb, integer, timestamp } from 'drizzle-orm/pg-core';
import { providerEnum, deliveryStatusEnum } from './enums.js';

/**
 * Durable retry queue (#27). A reply that fails after `ResilientExecutor`'s
 * in-process retries/circuit-breaker are exhausted lands here instead of
 * just being logged and lost — `DeliveryRecoveryWorker` sweeps it
 * periodically and retries through the same provider client, with bounded
 * backoff, until it's delivered or permanently marked failed.
 */
export const pendingDeliveries = pgTable('pending_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  provider: providerEnum('provider').notNull(),
  /** Internal conversation UUID — for logging/lookup, not delivery itself. */
  conversationId: uuid('conversation_id').notNull(),
  /** Provider-specific delivery target — `{providerEventId}` for Caspian, `{owner,repo,issueNumber}` for GitHub. */
  target: jsonb('target').notNull(),
  text: text('text').notNull(),
  status: deliveryStatusEnum('status').default('pending').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
