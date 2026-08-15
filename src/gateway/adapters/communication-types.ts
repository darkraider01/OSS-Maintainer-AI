import type { ProviderKey } from '../unified-event.js';

export type EventType =
  | 'MESSAGE_CREATED'
  | 'MESSAGE_EDITED'
  | 'MESSAGE_DELETED'
  | 'REACTION_ADDED'
  | 'REACTION_REMOVED'
  | 'THREAD_CREATED'
  | 'THREAD_ARCHIVED'
  | 'BOT_MENTIONED'
  | 'SYSTEM_EVENT';

export type MessageType =
  | 'text'
  | 'markdown'
  | 'html'
  | 'system'
  | 'notification'
  | 'command'
  | 'reaction'
  | 'edit'
  | 'delete'
  | 'thread_reply';

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  checksum?: string;
  thumbnail?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface Mention {
  actorId?: string; // Resolved internal actor if mapped
  providerUserId: string;
  displayName?: string;
  provider: ProviderKey;
}

export interface RepositoryContext {
  repositoryId?: string;
  provider: ProviderKey;
  organization?: string;
  owner: string;
  repositoryName: string;
  project?: string;
  branch?: string;
  defaultBranch?: string;
  /** Title of the issue/PR this event belongs to, when applicable (GitHub only). */
  issueTitle?: string;
  /** The issue/PR's own description — distinct from the triggering comment's text. */
  issueBody?: string;
}

export interface ConversationContext {
  conversationId: string;
  providerThreadId: string;
  providerChannelId: string;
  conversationType: string;
  participants: string[]; // List of actor IDs
  createdAt: string;
}

export interface UnifiedEvent {
  id: string; // provider:providerEventId
  provider: ProviderKey;
  providerEventId: string;
  eventType: EventType;
  messageType: MessageType;
  occurredAt: string;
  actorId: string; // Resolved via IdentityService
  conversationId: string; // Resolved via ConversationService
  conversationContext: ConversationContext;
  subject: string | null;
  text: string | null;
  attachments: Attachment[];
  mentions: Mention[];
  replyToId: string | null;
  repositoryContext?: RepositoryContext;
  metadata: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
}

export interface EventEnvelope {
  eventId: string;
  eventType: EventType;
  provider: ProviderKey;
  version: number; // schemaVersion e.g., 1
  occurredAt: string;
  correlationId: string;
  causationId: string;
  payload: UnifiedEvent;
  respond(text: string): Promise<void>;
}

export interface IDeduplicationService {
  isDuplicate(eventId: string, correlationId?: string): Promise<boolean>;
}

export interface IConversationService {
  resolveOrCreate(
    params: {
      provider: ProviderKey;
      channelType: string;
      externalThreadId: string;
      repositoryId?: string | null;
      metadata?: Record<string, unknown>;
    },
    correlationId?: string
  ): Promise<ConversationContext>;
}

export interface IIdentityService {
  resolveActor(
    params: {
      provider: ProviderKey;
      providerUserId: string;
      username: string;
      displayName?: string | null;
      avatarUrl?: string | null;
      email?: string | null;
    },
    correlationId?: string
  ): Promise<string>;

  isSelfEvent(
    provider: ProviderKey,
    providerUserId: string,
    correlationId?: string
  ): Promise<boolean>;
}

export interface IMessagePersistenceService {
  persist(envelope: EventEnvelope): Promise<void>;
}

export interface ICommunicationService {
  ingest(
    rawMessage: any,
    provider: ProviderKey,
    correlationId?: string
  ): Promise<EventEnvelope | null>;
}
