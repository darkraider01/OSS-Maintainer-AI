import { pgEnum } from 'drizzle-orm/pg-core';

// Generic Actor Type Enum
export const actorTypeEnum = pgEnum('actor_type', ['human', 'agent', 'bot', 'system']);

// Platform Provider Enum
export const providerEnum = pgEnum('provider', [
  'github',
  'gitlab',
  'bitbucket',
  'local',
  'azure_devops',
  'slack',
  'discord',
  'email',
]);

// Message Sender Type (polymorphic)
export const senderTypeEnum = pgEnum('sender_type', ['human', 'assistant']);

// Execution Run Status
export const executionStatusEnum = pgEnum('execution_status', [
  'idle',
  'running',
  'completed',
  'failed',
]);

// Execution Observation Log Type
export const executionEventTypeEnum = pgEnum('execution_event_type', [
  'reasoning',
  'observation',
  'tool_call_started',
  'tool_call_completed',
  'retry',
  'warning',
  'error',
  'output',
  'completion',
]);

// Tool Call Executions State
export const toolCallStatusEnum = pgEnum('tool_call_status', ['success', 'failed']);

// Resulting Artifact Type
export const artifactTypeEnum = pgEnum('artifact_type', [
  'summary',
  'report',
  'patch',
  'comment',
  'markdown',
]);

// Memory Cache scope
export const memoryScopeEnum = pgEnum('memory_scope', ['short_term', 'long_term']);

// Knowledge reference file type
export const knowledgeSourceTypeEnum = pgEnum('knowledge_source_type', ['file', 'website', 'doc']);

// Durable egress retry queue state (#27)
export const deliveryStatusEnum = pgEnum('delivery_status', ['pending', 'delivered', 'failed']);
