import type { InboundMessage } from '../caspian/inbound-message.js';
import { buildEventId } from '../unified-event.js';
import type { ActorReference, UnifiedEvent } from '../unified-event.js';
import type { IntegrationAdapter } from './types.js';

export interface SlackReference {
  channelId: string;
  ts: string;
  threadTs?: string | null;
}

export class SlackAdapter implements IntegrationAdapter {
  readonly channel = 'slack';
  readonly provider = 'slack' as const;

  /**
   * Normalizes Caspian's Slack channel payloads into the Unified Event Model.
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

    // Extract Slack specific thread timestamps (thread_ts / ts)
    const threadTs = (message.raw?.thread_ts || message.raw?.threadTs) as string | undefined | null;
    const ts = (message.raw?.ts || message.id) as string;

    const slackReference: SlackReference = {
      channelId: message.conversationId,
      ts,
      threadTs: threadTs || null,
    };

    return {
      id: buildEventId(this.provider, message.id),
      provider: this.provider,
      payloadType: 'message_sent',
      occurredAt:
        (message.raw?.ts as string) ||
        (message.raw?.timestamp as string) ||
        new Date().toISOString(),
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
        slack_reference: slackReference,
      },
    };
  }
}

export const slackAdapter = new SlackAdapter();
