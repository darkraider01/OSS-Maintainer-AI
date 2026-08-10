import { logger } from '../config/logger.js';
import { verifyGitHubWebhookSignature } from './github/webhook-signature.js';
import { normalizeGitHubWebhookEvent, extractMentions } from './adapters/github.js';
import type { ICommunicationService } from './adapters/communication-types.js';

export interface GitHubWebhookDelivery {
  body: Buffer | Uint8Array | string;
  headers: Record<string, string | string[] | undefined>;
}

export type GitHubWebhookStatus = 'accepted' | 'ignored';

export interface GitHubWebhookResult {
  status: GitHubWebhookStatus;
  reason?: string;
  eventId?: string;
}

export interface GitHubGatewayOptions {
  communicationService: ICommunicationService;
  webhookSecret: string;
  /** 'mentions' = only comment-type events that @-mention the bot; 'all' = every supported event. */
  receiveMode?: 'mentions' | 'all';
  /**
   * The GitHub App's bot login, e.g. `ossmaintainer-ai[bot]` (that's the
   * account's real, self-event-protection-relevant username). A `[bot]`
   * suffix is stripped for mention matching, since GitHub renders an
   * `@mention` of an App as `@ossmaintainer-ai` — never with the suffix.
   */
  botLogin?: string;
}

const COMMENT_EVENT_NAMES = new Set([
  'issue_comment',
  'pull_request_review',
  'pull_request_review_comment',
]);

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue;
    const resolved = Array.isArray(value) ? value[0] : value;
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Direct GitHub ingress (bypasses Caspian — GitHub is not a Caspian channel
 * in the live environment). Owns signature verification and webhook-to-
 * UnifiedEvent normalization; conversation/identity resolution happens via
 * `communicationService.ingest()`, the same entry point Slack/Discord use.
 * Egress and agent execution happen downstream through the shared event bus.
 */
export class GitHubGateway {
  private readonly communicationService: ICommunicationService;
  private readonly webhookSecret: string;
  private readonly receiveMode: 'mentions' | 'all';
  /** Normalized for @-mention comparison — the `[bot]` suffix, if any, is stripped. */
  private readonly mentionHandle?: string;

  constructor(options: GitHubGatewayOptions) {
    this.communicationService = options.communicationService;
    this.webhookSecret = options.webhookSecret;
    this.receiveMode = options.receiveMode ?? 'mentions';
    this.mentionHandle = options.botLogin?.toLowerCase().replace(/\[bot\]$/, '');
  }

  /** Handle one webhook delivery. Throws `GitHubWebhookVerificationError` on a bad signature. */
  async handleWebhook(delivery: GitHubWebhookDelivery): Promise<GitHubWebhookResult> {
    // eslint-disable-next-line no-console
    console.log('GitHub webhook received');

    verifyGitHubWebhookSignature(delivery.body, delivery.headers, this.webhookSecret);
    // eslint-disable-next-line no-console
    console.log('→ signature verified');

    const eventName = readHeader(delivery.headers, 'x-github-event');
    const deliveryId = readHeader(delivery.headers, 'x-github-delivery');
    if (!eventName || !deliveryId) {
      logger.warn(
        { hasEventName: Boolean(eventName), hasDeliveryId: Boolean(deliveryId) },
        'Ignoring GitHub webhook missing X-GitHub-Event/X-GitHub-Delivery headers'
      );
      return { status: 'ignored', reason: 'missing_headers' };
    }

    const text =
      typeof delivery.body === 'string'
        ? delivery.body
        : Buffer.from(delivery.body).toString('utf-8');
    // Malformed JSON throws SyntaxError — left to bubble so the HTTP layer maps it to 400,
    // the same way the Caspian webhook route already handles bad JSON.
    const payload: unknown = JSON.parse(text);
    const record =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};

    const normalized = normalizeGitHubWebhookEvent({ eventName, deliveryId, payload: record });
    if (!normalized) {
      logger.debug({ eventName, deliveryId }, 'Ignoring unsupported GitHub event/action');
      return { status: 'ignored', reason: 'unsupported_event' };
    }

    const text_ = (normalized.rawMessage.text as string | null | undefined) ?? null;
    if (this.shouldFilterByMention(eventName, text_)) {
      logger.debug({ eventName, deliveryId }, 'Ignoring GitHub event: bot was not mentioned');
      return { status: 'ignored', reason: 'not_mentioned' };
    }
    // eslint-disable-next-line no-console
    console.log('→ event normalized');

    const envelope = await this.communicationService.ingest(
      normalized.rawMessage,
      'github',
      deliveryId
    );
    if (!envelope) {
      logger.debug(
        { deliveryId },
        'GitHub event dropped by communication layer (duplicate delivery or self-authored event)'
      );
      return { status: 'ignored', reason: 'duplicate_or_self' };
    }

    // eslint-disable-next-line no-console
    console.log(`→ conversation resolved (${envelope.payload.conversationId})`);
    // eslint-disable-next-line no-console
    console.log(`→ actor resolved (${envelope.payload.actorId})`);

    return { status: 'accepted', eventId: envelope.eventId };
  }

  private shouldFilterByMention(eventName: string, text: string | null): boolean {
    if (this.receiveMode !== 'mentions') return false;
    if (!COMMENT_EVENT_NAMES.has(eventName)) return false;
    if (!this.mentionHandle) return false;
    if (!text) return true;
    return !extractMentions(text).some(
      (m) => m.providerUserId.toLowerCase() === this.mentionHandle
    );
  }
}
