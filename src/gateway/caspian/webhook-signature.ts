import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header the Caspian gateway signs every webhook delivery with. */
export const SIGNATURE_HEADER = 'x-caspian-signature';

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

/**
 * Verify a gateway webhook delivery: HMAC-SHA256 over the *raw* body, compared
 * in constant time against `x-caspian-signature: sha256=<hex>`.
 *
 * This mirrors the scheme the Caspian SDK uses in `handleWebhook`, which is not
 * published in the pinned SDK release — verifying here keeps webhook ingress on
 * the released SDK and stays wire-compatible when it ships.
 */
export function verifyWebhookSignature(
  body: Buffer | Uint8Array | string,
  headers: Record<string, string | string[] | undefined>,
  secret: string
): void {
  const signature = readHeader(headers, SIGNATURE_HEADER);
  if (!signature) {
    throw new WebhookVerificationError(`missing ${SIGNATURE_HEADER} header`);
  }

  const raw = typeof body === 'string' ? Buffer.from(body, 'utf-8') : Buffer.from(body);
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  const provided = Buffer.from(signature);
  const control = Buffer.from(expected);
  if (provided.length !== control.length || !timingSafeEqual(provided, control)) {
    throw new WebhookVerificationError('webhook signature mismatch');
  }
}

/** Sign a payload the way the gateway does — used by tests and local replay. */
export function signWebhookPayload(body: string, secret: string): string {
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
