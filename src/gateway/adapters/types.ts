import type { InboundMessage } from '../caspian/inbound-message.js';
import type { ProviderKey, UnifiedEvent } from '../unified-event.js';

/**
 * An integration adapter (ADR-0008). Adding a platform means adding one of
 * these — nothing in the orchestrator, agents, RAG or memory layers changes.
 */
export interface IntegrationAdapter {
  /** The Caspian channel key this adapter claims (e.g. `github`). */
  readonly channel: string;
  readonly provider: ProviderKey;
  /** Normalize a channel message into the Unified Event Model. */
  normalize(message: InboundMessage): UnifiedEvent;
}
