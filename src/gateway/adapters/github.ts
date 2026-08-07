import type { InboundMessage } from '../caspian/inbound-message.js';
import { buildEventId } from '../unified-event.js';
import type { ActorReference, PayloadType, UnifiedEvent } from '../unified-event.js';
import type { IntegrationAdapter } from './types.js';

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
