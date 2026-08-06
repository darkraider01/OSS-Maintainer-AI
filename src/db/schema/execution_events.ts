import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { executions } from './executions.js';
import { executionEventTypeEnum } from './enums.js';

export const executionEvents = pgTable(
  'execution_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    executionId: uuid('execution_id')
      .references(() => executions.id, { onDelete: 'cascade' })
      .notNull(),
    eventType: executionEventTypeEnum('event_type').notNull(),
    content: text('content').notNull(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('execution_events_execution_id_idx').on(table.executionId)]
);

export const executionEventsRelations = relations(executionEvents, ({ one }) => ({
  execution: one(executions, {
    fields: [executionEvents.executionId],
    references: [executions.id],
  }),
}));
