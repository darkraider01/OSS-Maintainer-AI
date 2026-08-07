import type { EventRecord, ListenOptions, Message } from 'caspian-sdk';
import { logger } from '../config/logger.js';
import { AdapterRegistry, createDefaultRegistry } from './adapters/registry.js';
import { fromEventRecord, fromSdkMessage } from './caspian/inbound-message.js';
import type { InboundMessage } from './caspian/inbound-message.js';
import { verifyWebhookSignature } from './caspian/webhook-signature.js';
import { EventBus } from './event-bus.js';
import type { EventEnvelope } from './unified-event.js';

/** The slice of the Caspian client the gateway depends on. */
export interface CaspianClientLike {
  onMessage(handler: (message: Message) => void | Promise<void>): unknown;
  reply(messageId: string, text?: string | null): Promise<unknown>;
  listen(opts?: ListenOptions): Promise<void>;
}

import type { ICommunicationService } from './adapters/communication-types.js';

export interface CaspianGatewayOptions {
  client: CaspianClientLike;
  bus: EventBus;
  registry?: AdapterRegistry;
  /** Channels accepted from the gateway; others are logged and dropped. */
  enabledChannels?: string[];
  /** Shared secret configured via `client.setWebhook(url, secret)`. */
  webhookSecret?: string;
  communicationService?: ICommunicationService;
}

export interface WebhookDelivery {
  body: Buffer | Uint8Array | string;
  headers: Record<string, string | string[] | undefined>;
}

export interface WebhookResult {
  status: 'ok' | 'ignored';
  accepted: number;
  ignored: number;
}

/** Bounded set of already-processed event ids, guarding against retries. */
class SeenEvents {
  private readonly ids = new Set<string>();

  constructor(private readonly maxSize = 2048) {}

  add(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    while (this.ids.size > this.maxSize) {
      const oldest = this.ids.values().next().value;
      if (oldest === undefined) break;
      this.ids.delete(oldest);
    }
    return true;
  }
}

/**
 * Caspian ingress (FR-1).
 *
 * Owns the single entry point for inbound messages, whichever transport
 * delivered them, and turns each one into a Unified Event on the internal bus.
 * Egress goes back out through the same Caspian conversation, so a reply always
 * lands on the channel the message came from.
 */
export class CaspianGateway {
  private readonly client: CaspianClientLike;
  private readonly bus: EventBus;
  private readonly registry: AdapterRegistry;
  private readonly enabledChannels: Set<string>;
  private readonly webhookSecret?: string;
  private readonly communicationService?: ICommunicationService;
  private readonly seen = new SeenEvents();
  private started = false;

  constructor(options: CaspianGatewayOptions) {
    this.client = options.client;
    this.bus = options.bus;
    this.registry = options.registry ?? createDefaultRegistry();
    this.enabledChannels = new Set(
      (options.enabledChannels ?? this.registry.channels()).map((c) => c.toLowerCase())
    );
    this.webhookSecret = options.webhookSecret;
    this.communicationService = options.communicationService;
  }

  /**
   * Attach the SDK message handler used by the polling loop. Idempotent, and
   * not needed in webhook mode — `handleWebhook` reaches `ingest` directly.
   */
  start(): this {
    if (this.started) return this;
    this.client.onMessage(async (message: Message) => {
      await this.ingest(fromSdkMessage(message));
    });
    this.started = true;
    logger.info(
      { channels: [...this.enabledChannels], adapters: this.registry.channels() },
      'Caspian gateway registered'
    );
    return this;
  }

  /** Run the SDK polling loop. Abort the signal to stop gracefully. */
  async listen(opts: ListenOptions = {}): Promise<void> {
    this.start();
    logger.info('Listening for Caspian events (poll mode)...');
    await this.client.listen(opts);
  }

  /**
   * Handle one webhook delivery (serverless / push mode). Verifies the gateway
   * signature before anything else touches the payload.
   */
  async handleWebhook(delivery: WebhookDelivery): Promise<WebhookResult> {
    if (!this.webhookSecret) {
      throw new Error('Webhook ingress requires a webhook secret');
    }
    verifyWebhookSignature(delivery.body, delivery.headers, this.webhookSecret);

    const text =
      typeof delivery.body === 'string'
        ? delivery.body
        : Buffer.from(delivery.body).toString('utf-8');
    const payload: unknown = JSON.parse(text);
    const events = (Array.isArray(payload) ? payload : [payload]) as EventRecord[];

    let accepted = 0;
    let ignored = 0;
    for (const event of events) {
      const eventId = String(event?.id ?? event?.seq ?? '');
      if (eventId && !this.seen.add(eventId)) {
        ignored += 1;
        continue;
      }
      const inbound = fromEventRecord(event);
      if (!inbound) {
        ignored += 1;
        continue;
      }
      // Second guard: a retry carrying a fresh event id must not double-post a reply.
      if (!this.seen.add(`message:${inbound.id}`)) {
        ignored += 1;
        continue;
      }
      if (await this.ingest(inbound)) accepted += 1;
      else ignored += 1;
    }

    return { status: accepted > 0 ? 'ok' : 'ignored', accepted, ignored };
  }

  /**
   * Normalize one message and publish it. Returns `false` when the channel is
   * not enabled or has no adapter.
   */
  async ingest(message: InboundMessage): Promise<boolean> {
    const channel = message.channel.toLowerCase();

    if (!this.enabledChannels.has(channel)) {
      logger.debug({ channel, messageId: message.id }, 'Channel not enabled; dropping message');
      return false;
    }

    const adapter = this.registry.resolve(channel);
    if (!adapter) {
      logger.warn({ channel, messageId: message.id }, 'No adapter registered for channel');
      return false;
    }

    const event = adapter.normalize(message);

    if (this.communicationService) {
      const richEnvelope = await this.communicationService.ingest(message.raw, event.provider);
      return richEnvelope !== null;
    }

    const envelope: EventEnvelope = {
      event,
      respond: async (text: string) => {
        await this.client.reply(message.id, text);
      },
    };

    logger.info(
      {
        eventId: event.id,
        provider: event.provider,
        payloadType: event.payloadType,
        actor: event.actorReference.handle,
      },
      'Inbound event normalized'
    );

    await this.bus.publish(envelope);
    return true;
  }
}
