import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { logger } from '../config/logger.js';
import type { CaspianGateway } from './caspian-gateway.js';
import { WebhookVerificationError } from './caspian/webhook-signature.js';
import type { GitHubGateway, GitHubWebhookResult } from './github-gateway.js';
import { GitHubWebhookVerificationError } from './github/webhook-signature.js';
import type { WebhookResult } from './caspian-gateway.js';
import type { AuthRouter } from '../web/auth-routes.js';
import { RateLimiter } from '../core/security/rate-limiter.js';
import { metrics } from '../core/observability/metrics.js';
import { IssueAnalyticsService } from '../core/analytics/issue-analytics-service.js';

/** Deliveries are small; anything larger is a mistake or an attack. */
const MAX_BODY_BYTES = 1_048_576;

/** Generous — real webhook providers can legitimately burst on a busy repo/workspace. */
const WEBHOOK_RATE_LIMIT = { windowMs: 10_000, maxRequests: 30 };
/** Stricter — the account-linking flow is human-driven, not provider-driven. */
const AUTH_RATE_LIMIT = { windowMs: 60_000, maxRequests: 20 };

/** Best-effort client IP: trusts X-Forwarded-For's first hop when present (reverse-proxy deployments), else the socket. */
function getClientIp(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return first?.trim() || request.socket.remoteAddress || 'unknown';
}

function sendRateLimited(response: ServerResponse, retryAfterMs: number): void {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const payload = JSON.stringify({ error: 'rate_limited' });
  response.writeHead(429, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Retry-After': String(retryAfterSeconds),
  });
  response.end(payload);
}

export interface GitHubRouteOptions {
  gateway: GitHubGateway;
  path: string;
}

export interface WebhookServerOptions {
  gateway: CaspianGateway;
  port: number;
  path: string;
  healthPath?: string;
  /** Optional second route: GitHub ingress shares this HTTP server/port. */
  github?: GitHubRouteOptions;
  /** Optional third route: the account-linking dashboard shares this HTTP server/port too. */
  auth?: AuthRouter;
  /**
   * Prometheus scrape endpoint. Unauthenticated by design, like the rest of
   * this app's routes (no application-API auth layer exists to hang this
   * off) — deploy behind network-level access control (VPC/firewall) if the
   * metric names/values shouldn't be publicly visible.
   */
  metricsPath?: string;
  /** Issue Analytics (#24) JSON endpoint — `?since=YYYY-MM-DD`, defaults to 30 days back. Same unauthenticated-by-default posture as metricsPath. */
  analyticsPath?: string;
}

export interface WebhookServer {
  server: Server;
  port: number;
  close(): Promise<void>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

/** Collect the raw bytes — the signature is computed over them, not over re-encoded JSON. */
function readRawBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // Stop buffering past the limit, but keep the socket alive so we can answer 413.
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Webhook payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Read the body, run it through `handler`, and map the outcome to an HTTP
 * response. Shared by the Caspian and GitHub routes so both get identical
 * size-limit, malformed-JSON, and signature-failure handling.
 */
async function handleDelivery<T>(
  request: IncomingMessage,
  response: ServerResponse,
  handler: (delivery: {
    body: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }) => Promise<T>,
  verificationErrorClasses: Array<new (...args: never[]) => Error>
): Promise<void> {
  let body: Buffer;
  try {
    body = await readRawBody(request);
  } catch (error) {
    logger.warn({ err: error }, 'Rejected oversized or unreadable webhook body');
    sendJson(response, 413, { error: 'payload_too_large' });
    return;
  }

  try {
    const result = await handler({ body, headers: request.headers });
    sendJson(response, 200, result);
  } catch (error) {
    if (verificationErrorClasses.some((errorClass) => error instanceof errorClass)) {
      logger.warn({ err: error }, 'Rejected webhook with invalid signature');
      sendJson(response, 401, { error: 'invalid_signature' });
      return;
    }
    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: 'invalid_json' });
      return;
    }
    logger.error({ err: error }, 'Webhook handling failed');
    sendJson(response, 500, { error: 'internal_error' });
  }
}

/**
 * HTTP ingress for `CASPIAN_INGRESS_MODE=webhook`, optionally sharing the
 * same port with the direct GitHub webhook route (GitHub is not a Caspian
 * channel, so it always needs its own public endpoint regardless of Caspian's
 * ingress mode).
 *
 * Register the public URL with the gateway using `client.setWebhook(url, secret)`
 * and point it at `path`; the same secret must be in `CASPIAN_WEBHOOK_SECRET`.
 */
export function createWebhookServer(options: WebhookServerOptions): Promise<WebhookServer> {
  const {
    gateway,
    port,
    path,
    healthPath = '/healthz',
    github,
    auth,
    metricsPath = '/metrics',
    analyticsPath = '/analytics',
  } = options;

  // Per-IP+provider — cheap to check before the expensive parts (signature
  // verification, DB writes) so a flooding source fails fast (PRD §10:
  // "return HTTP 429/Retry-After where appropriate", "don't break internal
  // event processing" — this only guards the HTTP edge, not the event bus).
  const caspianLimiter = new RateLimiter(WEBHOOK_RATE_LIMIT);
  const githubLimiter = new RateLimiter(WEBHOOK_RATE_LIMIT);
  const authLimiter = new RateLimiter(AUTH_RATE_LIMIT);
  const analyticsLimiter = new RateLimiter(AUTH_RATE_LIMIT);
  const analyticsService = new IssueAnalyticsService();

  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    const pathname = url.split('?')[0];

    if (request.method === 'GET' && pathname === healthPath) {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    if (request.method === 'GET' && pathname === metricsPath) {
      const body = metrics.render();
      response.writeHead(200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      });
      response.end(body);
      return;
    }

    if (request.method === 'GET' && pathname === analyticsPath) {
      const limit = analyticsLimiter.check(getClientIp(request));
      if (!limit.allowed) {
        sendRateLimited(response, limit.retryAfterMs);
        return;
      }
      const requestUrl = new URL(url, 'http://localhost');
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const since = requestUrl.searchParams.get('since') || thirtyDaysAgo;
      analyticsService
        .summarize(since)
        .then((summary) => sendJson(response, 200, summary))
        .catch((error: unknown) => {
          logger.error({ err: error }, 'Issue analytics query failed');
          sendJson(response, 500, { error: 'internal_error' });
        });
      return;
    }

    if (pathname === path) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        sendJson(response, 405, { error: 'method_not_allowed' });
        return;
      }
      const limit = caspianLimiter.check(getClientIp(request));
      if (!limit.allowed) {
        sendRateLimited(response, limit.retryAfterMs);
        return;
      }
      void handleDelivery<WebhookResult>(
        request,
        response,
        (delivery) => gateway.handleWebhook(delivery),
        [WebhookVerificationError]
      );
      return;
    }

    if (github && pathname === github.path) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        sendJson(response, 405, { error: 'method_not_allowed' });
        return;
      }
      const limit = githubLimiter.check(getClientIp(request));
      if (!limit.allowed) {
        sendRateLimited(response, limit.retryAfterMs);
        return;
      }
      void handleDelivery<GitHubWebhookResult>(
        request,
        response,
        (delivery) => github.gateway.handleWebhook(delivery),
        [GitHubWebhookVerificationError]
      );
      return;
    }

    if (auth) {
      const limit = authLimiter.check(getClientIp(request));
      if (!limit.allowed) {
        sendRateLimited(response, limit.retryAfterMs);
        return;
      }
      auth
        .handle(request, response, pathname)
        .then((handled) => {
          if (!handled) sendJson(response, 404, { error: 'not_found' });
        })
        .catch((error: unknown) => {
          logger.error({ err: error }, 'Auth route handling failed');
          sendJson(response, 500, { error: 'internal_error' });
        });
      return;
    }

    sendJson(response, 404, { error: 'not_found' });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      logger.info({ port: boundPort, path, githubPath: github?.path }, 'Webhook ingress listening');
      resolve({ server, port: boundPort, close: () => closeServer(server) });
    });
  });
}
