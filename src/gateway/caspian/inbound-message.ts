import type { EventRecord, Message } from 'caspian-sdk';

/**
 * A channel message, decoupled from the SDK's `Message` class.
 *
 * Both ingress paths converge here: the polling loop hands us an SDK `Message`,
 * while a webhook delivery hands us a raw `message.received` event record. The
 * adapters only ever see this shape.
 */
export interface InboundMessage {
  id: string;
  conversationId: string;
  connectionId: string;
  customerId: string;
  agentId: string;
  channel: string;
  sender: Record<string, unknown> | null;
  subject: string | null;
  text: string | null;
  html: string | null;
  /** The payload exactly as it arrived, for `rawPayload` preservation. */
  raw: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Build from the SDK `Message` delivered by `client.onMessage` (polling mode). */
export function fromSdkMessage(message: Message): InboundMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    connectionId: message.connectionId,
    customerId: message.customerId,
    agentId: message.agentId,
    channel: message.channel,
    sender: message.sender,
    subject: message.subject,
    text: message.text,
    html: message.html,
    raw: {
      id: message.id,
      conversation_id: message.conversationId,
      connection_id: message.connectionId,
      channel: message.channel,
      sender: message.sender,
      subject: message.subject,
      text: message.text,
      html: message.html,
      media: message.media,
    },
  };
}

/**
 * Build from a raw gateway event (webhook mode). Returns `null` for anything
 * that is not a usable `message.received` payload, so a malformed or unrelated
 * delivery is skipped rather than throwing.
 */
export function fromEventRecord(event: EventRecord): InboundMessage | null {
  if (event.type !== 'message.received') return null;

  const data = asRecord(event.data);
  const message = data && asRecord(data.message);
  if (!data || !message) return null;

  const id = asString(message.id);
  const conversationId = asString(message.conversation_id);
  if (!id || !conversationId) return null;

  return {
    id,
    conversationId,
    connectionId: asString(message.connection_id) ?? '',
    customerId: asString(data.customer_id) ?? '',
    agentId: asString(data.agent_id) ?? '',
    channel: asString(message.channel) ?? 'unknown',
    sender: asRecord(message.sender),
    subject: asString(message.subject),
    text: asString(message.text),
    html: asString(message.html),
    raw: message,
  };
}
