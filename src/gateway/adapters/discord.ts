import type { InboundMessage } from '../caspian/inbound-message.js';
import { buildEventId } from '../unified-event.js';
import type { ActorReference, UnifiedEvent } from '../unified-event.js';
import type { IntegrationAdapter } from './types.js';

export class DiscordAdapter implements IntegrationAdapter {
  readonly channel = 'discord';
  readonly provider = 'discord' as const;

  /**
   * Normalizes Caspian's Discord channel payloads into the Unified Event Model.
   */
  normalize(message: InboundMessage): UnifiedEvent {
    const actorIdKeys = ['id', 'user_id', 'provider_id', 'providerActorId'];
    const handleKeys = ['username', 'login', 'name', 'handle'];
    const displayNameKeys = ['display_name', 'real_name', 'name', 'full_name'];

    const pickString = (source: Record<string, unknown> | null, keys: string[]): string | null => {
      if (!source) return null;
      for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.length > 0) return value;
        if (typeof value === 'number') return String(value);
      }
      return null;
    };

    const actorReference: ActorReference = {
      provider: this.provider,
      providerActorId: pickString(message.sender, actorIdKeys),
      handle: pickString(message.sender, handleKeys),
      displayName: pickString(message.sender, displayNameKeys),
    };

    return {
      id: buildEventId(this.provider, message.id),
      provider: this.provider,
      payloadType: 'message_sent',
      occurredAt: (message.raw?.timestamp as string) || new Date().toISOString(),
      actorReference,
      conversationReference: {
        provider: this.provider,
        conversationId: message.conversationId,
        connectionId: message.connectionId,
        messageId: message.id,
      },
      subject: message.subject,
      text: message.text,
      rawPayload: {
        ...message.raw,
      },
    };
  }
}

export const discordAdapter = new DiscordAdapter();
