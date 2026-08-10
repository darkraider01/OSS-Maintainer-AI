import type { InboundMessage } from '../caspian/inbound-message.js';
import { buildEventId } from '../unified-event.js';
import type { ActorReference, PayloadType, UnifiedEvent } from '../unified-event.js';
import type { IntegrationAdapter } from './types.js';
import type { EventType, Mention, RepositoryContext } from './communication-types.js';

/** Matches an issue or pull-request permalink anywhere in the payload. */
const GITHUB_REFERENCE = /github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/i;
/** Matches the `owner/repo#123` shorthand Caspian puts in the subject line. */
const SHORTHAND_REFERENCE = /\b([\w.-]+)\/([\w.-]+)#(\d+)\b/;

export interface GitHubReference {
  owner: string;
  repo: string;
  number: number;
  kind: 'issue' | 'pull_request';
}

/** Ordered candidates for the GitHub login, most specific first. */
const HANDLE_KEYS = ['login', 'handle', 'username', 'address', 'name'];
const ACTOR_ID_KEYS = ['id', 'external_id', 'provider_id', 'user_id'];
const DISPLAY_NAME_KEYS = ['display_name', 'name', 'full_name'];
const TIMESTAMP_KEYS = ['created_at', 'timestamp', 'sent_at', 'occurred_at'];

function pickString(source: Record<string, unknown> | null, keys: string[]): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number') return String(value);
  }
  return null;
}

/** Every top-level string in the payload, so references can be found wherever they sit. */
function scannableText(message: InboundMessage): string {
  const parts = [message.subject, message.text, message.html];
  for (const value of Object.values(message.raw)) {
    if (typeof value === 'string') parts.push(value);
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * Extract the repository and issue/PR number the message belongs to. Returns
 * `null` when the payload carries no recognizable reference — the event is
 * still normalized, just without repository context.
 */
export function parseGitHubReference(message: InboundMessage): GitHubReference | null {
  const haystack = scannableText(message);

  const permalink = GITHUB_REFERENCE.exec(haystack);
  if (permalink) {
    return {
      owner: permalink[1],
      repo: permalink[2],
      number: Number(permalink[4]),
      kind: permalink[3].toLowerCase() === 'pull' ? 'pull_request' : 'issue',
    };
  }

  const shorthand = SHORTHAND_REFERENCE.exec(haystack);
  if (shorthand) {
    return {
      owner: shorthand[1],
      repo: shorthand[2],
      number: Number(shorthand[3]),
      kind: /pull request|\bPR\b/i.test(haystack) ? 'pull_request' : 'issue',
    };
  }

  return null;
}

function resolveActor(message: InboundMessage): ActorReference {
  return {
    provider: 'github',
    providerActorId: pickString(message.sender, ACTOR_ID_KEYS),
    handle: pickString(message.sender, HANDLE_KEYS),
    displayName: pickString(message.sender, DISPLAY_NAME_KEYS),
  };
}

/**
 * Caspian's GitHub channel delivers issue and pull-request comments as
 * `message.received`. We keep the finer-grained distinction so the orchestrator
 * can route on it later.
 */
function resolvePayloadType(reference: GitHubReference | null): PayloadType {
  if (!reference) return 'message_sent';
  return reference.kind === 'pull_request' ? 'pr_comment_created' : 'issue_comment_created';
}

/** Normalizes Caspian's GitHub channel into the Unified Event Model. */
export class GitHubAdapter implements IntegrationAdapter {
  readonly channel = 'github';
  readonly provider = 'github' as const;

  normalize(message: InboundMessage): UnifiedEvent {
    const reference = parseGitHubReference(message);

    return {
      id: buildEventId(this.provider, message.id),
      provider: this.provider,
      payloadType: resolvePayloadType(reference),
      occurredAt: pickString(message.raw, TIMESTAMP_KEYS) ?? new Date().toISOString(),
      actorReference: resolveActor(message),
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
        // Derived context, kept alongside the untouched payload.
        github_reference: reference,
      },
    };
  }
}

export const githubAdapter = new GitHubAdapter();

/* ------------------------------------------------------------------------
 * Direct GitHub webhook normalization (bypasses Caspian entirely).
 *
 * GitHub is not available as a Caspian channel today, so real GitHub events
 * arrive at a dedicated webhook endpoint instead of the Caspian gateway. This
 * section shapes a raw GitHub webhook delivery into the duck-typed message
 * `CommunicationService.ingest()` already accepts — the same rich Unified
 * Event Model Slack and Discord produce, not a GitHub-specific one.
 * ------------------------------------------------------------------------ */

/** The five events this integration understands; anything else is ignored. */
const SUPPORTED_GITHUB_ACTIONS: Record<string, string[]> = {
  issues: ['opened'],
  issue_comment: ['created'],
  pull_request: ['opened'],
  pull_request_review: ['submitted'],
  pull_request_review_comment: ['created'],
};

export function isSupportedGitHubWebhookEvent(eventName: string, action: string | null): boolean {
  const allowed = SUPPORTED_GITHUB_ACTIONS[eventName];
  return Boolean(allowed && action && allowed.includes(action));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export interface GitHubRepositoryInfo {
  owner: string;
  repo: string;
}

function extractRepository(payload: Record<string, unknown>): GitHubRepositoryInfo | null {
  const repository = asRecord(payload.repository);
  if (!repository) return null;
  const owner = asRecord(repository.owner);
  const ownerLogin = owner ? asString(owner.login) : null;
  const repoName = asString(repository.name);
  if (!ownerLogin || !repoName) return null;
  return { owner: ownerLogin, repo: repoName };
}

/** GitHub logins: alphanumeric and hyphens, no leading/trailing/double hyphen, max 39 chars. */
const MENTION_PATTERN = /@([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?)/g;

export function extractMentions(text: string | null): Mention[] {
  if (!text) return [];
  const seen = new Set<string>();
  const mentions: Mention[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const login = match[1];
    const key = login.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push({ providerUserId: login, displayName: login, provider: 'github' });
  }
  return mentions;
}

function resolveWebhookSender(payload: Record<string, unknown>): Record<string, unknown> {
  const sender = asRecord(payload.sender) ?? {};
  return {
    id: sender.id ?? null,
    login: sender.login ?? null,
    avatarUrl: asString(sender.avatar_url),
    email: asString(sender.email),
    type: sender.type ?? null,
  };
}

interface ExtractedGitHubEvent {
  kind: 'issue' | 'pull_request';
  number: number;
  text: string | null;
  subject: string | null;
  occurredAt: string;
  htmlUrl: string | null;
  commentId: number | null;
  replyToId: string | null;
}

/** Field mapping differs per event; GitHub treats a PR as an issue for comments. */
function extractEventDetails(
  eventName: string,
  payload: Record<string, unknown>
): ExtractedGitHubEvent | null {
  switch (eventName) {
    case 'issues': {
      const issue = asRecord(payload.issue);
      const number = issue ? asNumber(issue.number) : null;
      if (!issue || number === null) return null;
      return {
        kind: 'issue',
        number,
        text: asString(issue.body),
        subject: asString(issue.title),
        occurredAt: asString(issue.created_at) ?? new Date().toISOString(),
        htmlUrl: asString(issue.html_url),
        commentId: null,
        replyToId: null,
      };
    }
    case 'issue_comment': {
      const issue = asRecord(payload.issue);
      const comment = asRecord(payload.comment);
      const number = issue ? asNumber(issue.number) : null;
      if (!issue || !comment || number === null) return null;
      const isPullRequest = Boolean(asRecord(issue.pull_request));
      return {
        kind: isPullRequest ? 'pull_request' : 'issue',
        number,
        text: asString(comment.body),
        subject: asString(issue.title),
        occurredAt: asString(comment.created_at) ?? new Date().toISOString(),
        htmlUrl: asString(comment.html_url),
        commentId: asNumber(comment.id),
        replyToId: null,
      };
    }
    case 'pull_request': {
      const pr = asRecord(payload.pull_request);
      const number = pr ? asNumber(pr.number) : null;
      if (!pr || number === null) return null;
      return {
        kind: 'pull_request',
        number,
        text: asString(pr.body),
        subject: asString(pr.title),
        occurredAt: asString(pr.created_at) ?? new Date().toISOString(),
        htmlUrl: asString(pr.html_url),
        commentId: null,
        replyToId: null,
      };
    }
    case 'pull_request_review': {
      const pr = asRecord(payload.pull_request);
      const review = asRecord(payload.review);
      const number = pr ? asNumber(pr.number) : null;
      if (!pr || !review || number === null) return null;
      return {
        kind: 'pull_request',
        number,
        text: asString(review.body),
        subject: asString(pr.title),
        occurredAt: asString(review.submitted_at) ?? new Date().toISOString(),
        htmlUrl: asString(review.html_url),
        commentId: asNumber(review.id),
        replyToId: null,
      };
    }
    case 'pull_request_review_comment': {
      const pr = asRecord(payload.pull_request);
      const comment = asRecord(payload.comment);
      const number = pr ? asNumber(pr.number) : null;
      if (!pr || !comment || number === null) return null;
      const inReplyTo = asNumber(comment.in_reply_to_id);
      return {
        kind: 'pull_request',
        number,
        text: asString(comment.body),
        subject: asString(pr.title),
        occurredAt: asString(comment.created_at) ?? new Date().toISOString(),
        htmlUrl: asString(comment.html_url),
        commentId: asNumber(comment.id),
        replyToId: inReplyTo !== null ? String(inReplyTo) : null,
      };
    }
    default:
      return null;
  }
}

function mapGitHubEventType(eventName: string, action: string): EventType {
  if ((eventName === 'issues' || eventName === 'pull_request') && action === 'opened') {
    return 'THREAD_CREATED';
  }
  return 'MESSAGE_CREATED';
}

export interface NormalizeGitHubWebhookParams {
  /** Value of the `X-GitHub-Event` header. */
  eventName: string;
  /** Value of the `X-GitHub-Delivery` header — doubles as the dedup key. */
  deliveryId: string;
  payload: Record<string, unknown>;
}

export interface NormalizedGitHubWebhook {
  /** Duck-typed message shaped for `CommunicationService.ingest()`. */
  rawMessage: Record<string, unknown>;
  repository: GitHubRepositoryInfo;
  issueNumber: number;
  kind: 'issue' | 'pull_request';
}

/**
 * Normalize a raw GitHub webhook delivery into the message shape
 * `CommunicationService.ingest()` consumes to build the rich Unified Event.
 * Returns `null` for unsupported event/action combinations, or payloads
 * missing the repository/issue/PR context an event of that type requires —
 * the webhook route responds 200 and simply drops these, matching GitHub's
 * expectation that unhandled event types are acknowledged, not rejected.
 */
export function normalizeGitHubWebhookEvent(
  params: NormalizeGitHubWebhookParams
): NormalizedGitHubWebhook | null {
  const { eventName, deliveryId, payload } = params;
  const action = asString(payload.action);
  if (!isSupportedGitHubWebhookEvent(eventName, action)) return null;

  const repository = extractRepository(payload);
  const details = extractEventDetails(eventName, payload);
  if (!repository || !details) return null;

  const conversationId = `${repository.owner}/${repository.repo}#${details.number}`;
  const mentions = extractMentions(details.text);
  const sender = resolveWebhookSender(payload);

  const repositoryContext: RepositoryContext = {
    provider: 'github',
    owner: repository.owner,
    repositoryName: repository.repo,
  };

  const rawMessage: Record<string, unknown> = {
    id: deliveryId,
    sender,
    channel: details.kind,
    conversationId,
    subject: details.subject,
    text: details.text,
    occurredAt: details.occurredAt,
    attachments: [],
    mentions,
    replyToId: details.replyToId,
    eventType: mapGitHubEventType(eventName, action as string),
    messageType: 'text',
    repositoryContext,
    metadata: {
      github: {
        eventName,
        action,
        owner: repository.owner,
        repo: repository.repo,
        issueNumber: details.number,
        kind: details.kind,
        commentId: details.commentId,
        htmlUrl: details.htmlUrl,
        deliveryId,
        // Original payload exactly as GitHub sent it — preserved, not discarded.
        payload,
      },
    },
  };

  return { rawMessage, repository, issueNumber: details.number, kind: details.kind };
}
