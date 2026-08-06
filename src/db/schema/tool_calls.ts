import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  integer,
  text,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { executions } from './executions.js';
import { toolCallStatusEnum, providerEnum } from './enums.js';

export const toolCalls = pgTable(
  'tool_calls',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    executionId: uuid('execution_id')
      .references(() => executions.id, { onDelete: 'cascade' })
      .notNull(),
    toolName: varchar('tool_name', { length: 255 }).notNull(),
    inputParameters: jsonb('input_parameters').notNull(),
    outputResult: jsonb('output_result'),
    status: toolCallStatusEnum('status').notNull(),
    provider: providerEnum('provider').notNull(),
    traceId: varchar('trace_id', { length: 255 }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    retryCount: integer('retry_count').default(0).notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('tool_calls_execution_id_idx').on(table.executionId)]
);

export const toolCallsRelations = relations(toolCalls, ({ one }) => ({
  execution: one(executions, {
    fields: [toolCalls.executionId],
    references: [executions.id],
  }),
}));
