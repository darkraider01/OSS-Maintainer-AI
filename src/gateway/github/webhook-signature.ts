import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header GitHub signs every webhook delivery with. */
export const SIGNATURE_HEADER = 'x-hub-signature-256';

export class GitHubWebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubWebhookVerificationError';
  }
}

/**
 * Verify a GitHub webhook delivery: HMAC-SHA256 over the *raw* body, compared
 * in constant time against `x-hub-signature-256: sha256=<hex>`.
 *
 * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */
export function verifyGitHubWebhookSignature(
  body: Buffer | Uint8Array | string,
  headers: Record<string, string | string[] | undefined>,
  secret: string
): void {
  const signature = readHeader(headers, SIGNATURE_HEADER);
  if (!signature) {
    throw new GitHubWebhookVerificationError(`missing ${SIGNATURE_HEADER} header`);
  }

  const raw = typeof body === 'string' ? Buffer.from(body, 'utf-8') : Buffer.from(body);
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  const provided = Buffer.from(signature);
  const control = Buffer.from(expected);
  if (provided.length !== control.length || !timingSafeEqual(provided, control)) {
    throw new GitHubWebhookVerificationError('webhook signature mismatch');
  }
}

/** Sign a payload the way GitHub does — used by tests and local replay. */
export function signGitHubPayload(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(Buffer.from(body, 'utf-8')).digest('hex')}`;
}

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
