import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaspianGateway } from '../../src/gateway/caspian-gateway.js';
import { EventBus } from '../../src/gateway/event-bus.js';
import { createWebhookServer } from '../../src/gateway/webhook-server.js';
import type { WebhookServer } from '../../src/gateway/webhook-server.js';
import { signWebhookPayload } from '../../src/gateway/caspian/webhook-signature.js';
import { registerEchoHandler } from '../../src/core/handlers/echo-handler.js';
import { fakeClient, messageEvent } from '../helpers/fixtures.js';
import type { FakeClient } from '../helpers/fixtures.js';

const SECRET = 'whsec_test';
const PATH = '/webhooks/caspian';

let client: FakeClient;
let server: WebhookServer;

async function post(body: string, signature?: string) {
  return fetch(`http://127.0.0.1:${server.port}${PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(signature ? { 'x-caspian-signature': signature } : {}),
    },
    body,
  });
}

beforeEach(async () => {
  client = fakeClient();
  const bus = new EventBus();
  registerEchoHandler(bus);
  const gateway = new CaspianGateway({
    client,
    bus,
    enabledChannels: ['github'],
    webhookSecret: SECRET,
  });
  server = await createWebhookServer({ gateway, port: 0, path: PATH });
});

afterEach(async () => {
  await server.close();
});

describe('webhook server rate limiting (#26)', () => {
  it('returns 429 with Retry-After once a single source exceeds the per-IP webhook limit', async () => {
    const body = JSON.stringify(messageEvent());
    const signature = signWebhookPayload(body, SECRET);

    // The limiter allows 30 requests per 10s window per IP+route; the 31st should be rejected.
    let lastResponse: Response | undefined;
    for (let i = 0; i < 31; i += 1) {
      lastResponse = await post(body, signature);
    }

    expect(lastResponse!.status).toBe(429);
    expect(lastResponse!.headers.get('Retry-After')).toBeTruthy();
    await expect(lastResponse!.json()).resolves.toEqual({ error: 'rate_limited' });
  });
});
