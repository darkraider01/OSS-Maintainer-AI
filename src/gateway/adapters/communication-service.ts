import type {
  ICommunicationService,
  IDeduplicationService,
  IConversationService,
  IIdentityService,
  IMessagePersistenceService,
  EventEnvelope,
  UnifiedEvent,
  EventType,
  MessageType,
} from './communication-types.js';
import type { ProviderKey } from '../unified-event.js';
import { logger } from '../../config/logger.js';
import { randomUUID } from 'crypto';

export class CommunicationService implements ICommunicationService {
  constructor(
    private readonly deduplicationService: IDeduplicationService,
    private readonly conversationService: IConversationService,
    private readonly identityService: IIdentityService,
    private readonly messagePersistenceService: IMessagePersistenceService,
    private readonly eventPublisher: (envelope: EventEnvelope) => Promise<void>
  ) {}

  async ingest(
    rawMessage: any,
    provider: ProviderKey,
    correlationId: string = randomUUID()
  ): Promise<EventEnvelope | null> {
    const log = logger.child({ correlationId, provider });
    log.info('Ingesting raw platform message');

    const providerEventId = rawMessage.id;
    const eventId = `${provider}:${providerEventId}`;

    // 1. Deduplication
    if (await this.deduplicationService.isDuplicate(eventId, correlationId)) {
      log.warn({ eventId }, 'Dropped duplicate event during ingestion');
      return null;
    }

    // Self-event loop protection
    const providerUserId = rawMessage.sender?.id || rawMessage.sender?.providerActorId || 'unknown';
    if (await this.identityService.isSelfEvent(provider, providerUserId, correlationId)) {
      log.info({ providerUserId }, 'Dropped self-event loop message');
      return null;
    }

    // 2. Identity Resolution
    const actorId = await this.identityService.resolveActor(
      {
        provider,
        providerUserId,
        username: rawMessage.sender?.login || rawMessage.sender?.username || 'unknown_user',
        displayName: rawMessage.sender?.name || rawMessage.sender?.displayName || null,
        avatarUrl: rawMessage.sender?.avatarUrl || null,
        email: rawMessage.sender?.email || null,
      },
      correlationId
    );

    // 3. Conversation Resolution
    const conversationContext = await this.conversationService.resolveOrCreate(
      {
        provider,
        channelType: rawMessage.channel || 'message_sent',
        externalThreadId: rawMessage.conversationId || 'default_thread',
        repositoryId: null,
      },
      correlationId
    );

    // 4. Create UnifiedEvent Model (Version 1)
    const eventType: EventType = rawMessage.eventType || 'MESSAGE_CREATED';
    const messageType: MessageType = rawMessage.messageType || 'text';

    const unifiedEvent: UnifiedEvent = {
      id: eventId,
      provider,
      providerEventId,
      eventType,
      messageType,
      occurredAt: rawMessage.occurredAt || new Date().toISOString(),
      actorId,
      conversationId: conversationContext.conversationId,
      conversationContext,
      subject: rawMessage.subject || null,
      text: rawMessage.text || null,
      attachments: rawMessage.attachments || [],
      mentions: rawMessage.mentions || [],
      replyToId: rawMessage.replyToId || null,
      metadata: rawMessage.metadata || {},
      rawPayload: rawMessage,
    };

    // 5. Wrap in Traceable EventEnvelope
    const envelope: EventEnvelope = {
      eventId,
      eventType,
      provider,
      version: 1, // schemaVersion: 1
      occurredAt: unifiedEvent.occurredAt,
      correlationId,
      causationId: eventId,
      payload: unifiedEvent,
      respond: async (text: string) => {
        log.info({ text }, 'Sending egress response to conversation');
      },
    };

    // 6. Persistence
    await this.messagePersistenceService.persist(envelope);

    // 7. Publish to bus
    await this.eventPublisher(envelope);

    log.info({ eventId }, 'Ingestion and mapping successfully completed');
    return envelope;
  }
}
