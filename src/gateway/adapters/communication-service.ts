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
  RepositoryContext,
} from './communication-types.js';
import type { ProviderKey } from '../unified-event.js';
import { logger } from '../../config/logger.js';
import { randomUUID } from 'crypto';
import { RateLimiter } from '../../core/security/rate-limiter.js';
import { metrics } from '../../core/observability/metrics.js';

/** Generous enough for normal back-and-forth conversation; catches spam/abuse, not chattiness. */
const ACTOR_RATE_LIMIT = { windowMs: 60_000, maxRequests: 20 };
/** Higher than the per-actor limit — a busy thread has multiple actors, not one flooding it. */
const CONVERSATION_RATE_LIMIT = { windowMs: 60_000, maxRequests: 40 };

export class CommunicationService implements ICommunicationService {
  private readonly actorLimiter = new RateLimiter(ACTOR_RATE_LIMIT);
  private readonly conversationLimiter = new RateLimiter(CONVERSATION_RATE_LIMIT);

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
    metrics.eventsReceivedTotal.inc({ provider });

    const providerEventId = rawMessage.id;
    const eventId = `${provider}:${providerEventId}`;

    // 1. Deduplication
    if (await this.deduplicationService.isDuplicate(eventId, correlationId)) {
      log.warn({ eventId }, 'Dropped duplicate event during ingestion');
      metrics.deduplicatedEventsTotal.inc({ provider });
      return null;
    }

    const pickString = (source: any, keys: string[]): string | null => {
      if (!source || typeof source !== 'object') return null;
      for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.length > 0) return value;
        if (typeof value === 'number') return String(value);
      }
      return null;
    };

    // Self-event loop protection
    // 'address' matters: Caspian doesn't consistently shape `sender` the
    // same way across message contexts — a thread reply can carry the
    // sender's id under `address` (e.g. Slack's user ID) with no `id` field
    // at all, unlike a top-level channel message. Missing it here doesn't
    // just lose a field: it silently mints a brand-new, unlinked identity
    // for a sender who already has one (breaks identity linking, splits
    // conversation history across two actors).
    const providerUserId =
      pickString(rawMessage.sender, [
        'id',
        'user_id',
        'provider_id',
        'providerActorId',
        'address',
      ]) || 'unknown';
    if (providerUserId === 'unknown') {
      log.warn(
        { sender: rawMessage.sender },
        'Could not resolve a provider_user_id from message.sender; falling back to "unknown" (creates a fresh unlinked identity instead of matching the real sender)'
      );
    }
    if (await this.identityService.isSelfEvent(provider, providerUserId, correlationId)) {
      log.info({ providerUserId }, 'Dropped self-event loop message');
      return null;
    }

    // 2. Identity Resolution
    const actorId = await this.identityService.resolveActor(
      {
        provider,
        providerUserId,
        username:
          pickString(rawMessage.sender, ['username', 'login', 'name', 'handle']) || 'unknown_user',
        displayName: pickString(rawMessage.sender, [
          'display_name',
          'real_name',
          'name',
          'full_name',
        ]),
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
        // Caspian's real wire format (both webhook and polling ingress) uses
        // snake_case `conversation_id`; the GitHub webhook path builds a
        // synthetic message with camelCase `conversationId` directly for
        // this same ingest() contract. Accept either so a real per-thread id
        // is never mistaken for "no id" and collapsed into the shared
        // 'default_thread' fallback (that collapse merges every Slack/Discord
        // conversation across every user into one conversation row).
        externalThreadId:
          pickString(rawMessage, ['conversationId', 'conversation_id']) || 'default_thread',
        repositoryId: null,
      },
      correlationId
    );

    // 3b. Rate limiting — per-actor and per-conversation, dropped the same
    // way a duplicate is (no HTTP context this deep in the pipeline to
    // return 429/Retry-After against; that happens at the webhook HTTP
    // layer instead). Protects the LLM/DB/GitHub-egress work downstream from
    // one spamming actor or a flooded thread, without touching provider-side
    // ingress at all.
    const actorLimit = this.actorLimiter.check(actorId);
    if (!actorLimit.allowed) {
      log.warn({ actorId }, 'Dropped event: actor exceeded rate limit');
      return null;
    }
    const conversationLimit = this.conversationLimiter.check(conversationContext.conversationId);
    if (!conversationLimit.allowed) {
      log.warn(
        { conversationId: conversationContext.conversationId },
        'Dropped event: conversation exceeded rate limit'
      );
      return null;
    }

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
      repositoryContext:
        (rawMessage.repositoryContext as RepositoryContext | undefined) ?? undefined,
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
