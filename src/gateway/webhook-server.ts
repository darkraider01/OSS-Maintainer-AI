import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { logger } from '../config/logger.js';
import type { CaspianGateway } from './caspian-gateway.js';
import { WebhookVerificationError } from './caspian/webhook-signature.js';

/** Deliveries are small; anything larger is a mistake or an attack. */
const MAX_BODY_BYTES = 1_048_576;

export interface WebhookServerOptions {
  gateway: CaspianGateway;
  port: number;
  path: string;
  healthPath?: string;
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
 * HTTP ingress for `CASPIAN_INGRESS_MODE=webhook`.
 *
 * Register the public URL with the gateway using `client.setWebhook(url, secret)`
 * and point it at `path`; the same secret must be in `CASPIAN_WEBHOOK_SECRET`.
 */
export function createWebhookServer(options: WebhookServerOptions): Promise<WebhookServer> {
  const { gateway, port, path, healthPath = '/healthz' } = options;

  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    const pathname = url.split('?')[0];

    if (request.method === 'GET' && pathname === healthPath) {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    if (pathname !== path) {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }

    void handleDelivery(request, response);
  });

  async function handleDelivery(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body: Buffer;
    try {
      body = await readRawBody(request);
    } catch (error) {
      logger.warn({ err: error }, 'Rejected oversized or unreadable webhook body');
      sendJson(response, 413, { error: 'payload_too_large' });
      return;
    }

    try {
      const result = await gateway.handleWebhook({ body, headers: request.headers });
      sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
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

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      logger.info({ port: boundPort, path }, 'Caspian webhook ingress listening');
      resolve({ server, port: boundPort, close: () => closeServer(server) });
    });
  });
}
