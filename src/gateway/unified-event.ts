/**
 * The Unified Event Model (ADR-0008).
 *
 * Every platform adapter normalizes its payload into this shape before the
 * event reaches the internal event bus, so the orchestrator never sees a
 * platform-specific schema.
 */

/** Platform key. GitHub is the first integration; more are added by adapter only. */
export type ProviderKey = 'github' | 'slack' | 'discord' | 'telegram' | 'email' | 'unknown';

/** The action a normalized event represents. */
export type PayloadType =
  | 'message_sent'
  | 'issue_created'
  | 'issue_comment_created'
  | 'pr_opened'
  | 'pr_comment_created'
  | 'unknown';

/** Identifies the sender, ready to be mapped onto a unified actor. */
export interface ActorReference {
  provider: ProviderKey;
  /** Stable platform-side id, when the platform supplies one. */
  providerActorId: string | null;
  /** Platform handle (GitHub login, Slack user name, ...). */
  handle: string | null;
  displayName: string | null;
}

/** Maps the event onto the channel/thread it belongs to. */
export interface ConversationReference {
  provider: ProviderKey;
  /** Caspian conversation id — the reply target for the whole thread. */
  conversationId: string;
  /** Caspian connection id — which installed channel delivered this. */
  connectionId: string;
  /** Caspian message id, used to reply in-thread. */
  messageId: string;
}

export interface UnifiedEvent {
  /** Deterministic id: `${provider}:${messageId}` — safe to dedupe on. */
  id: string;
  provider: ProviderKey;
  payloadType: PayloadType;
  occurredAt: string;
  actorReference: ActorReference;
  conversationReference: ConversationReference;
  subject: string | null;
  text: string | null;
  /** Original integration payload, preserved verbatim for platform-specific reads. */
  rawPayload: Record<string, unknown>;
}

/**
 * A unified event plus the egress handle that closes the loop back to the
 * originating channel. Subscribers reply through `respond` and never touch the
 * Caspian SDK directly.
 */
export interface EventEnvelope {
  event: UnifiedEvent;
  respond(text: string): Promise<void>;
}

export function buildEventId(provider: ProviderKey, messageId: string): string {
  return `${provider}:${messageId}`;
}
