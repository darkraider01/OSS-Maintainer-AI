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
  // Port 0 lets the OS pick a free port.
  server = await createWebhookServer({ gateway, port: 0, path: PATH });
});

afterEach(async () => {
  await server.close();
});

describe('webhook server', () => {
  it('answers health checks', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('accepts a signed delivery and echoes back through Caspian', async () => {
    const body = JSON.stringify(messageEvent());

    const response = await post(body, signWebhookPayload(body, SECRET));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', accepted: 1, ignored: 0 });
    expect(client.replies).toHaveLength(1);
    expect(client.replies[0].text).toContain('OSS-Maintainer-AI received your message via github');
  });

  it('rejects an unsigned delivery with 401', async () => {
    const response = await post(JSON.stringify(messageEvent()));

    expect(response.status).toBe(401);
    expect(client.replies).toHaveLength(0);
  });

  it('rejects a tampered body with 401', async () => {
    const body = JSON.stringify(messageEvent());
    const signature = signWebhookPayload(body, SECRET);

    const response = await post(JSON.stringify(messageEvent({ seq: 99 })), signature);

    expect(response.status).toBe(401);
    expect(client.replies).toHaveLength(0);
  });

  it('rejects malformed JSON with 400', async () => {
    const body = '{not json';

    const response = await post(body, signWebhookPayload(body, SECRET));

    expect(response.status).toBe(400);
  });

  it('rejects the wrong HTTP method with 405', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}${PATH}`);

    expect(response.status).toBe(405);
  });

  it('returns 404 for unknown paths', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/nope`, { method: 'POST' });

    expect(response.status).toBe(404);
  });
});
