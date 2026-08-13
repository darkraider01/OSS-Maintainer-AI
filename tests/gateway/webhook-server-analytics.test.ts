import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CaspianGateway } from '../../src/gateway/caspian-gateway.js';
import { EventBus } from '../../src/gateway/event-bus.js';
import { createWebhookServer } from '../../src/gateway/webhook-server.js';
import type { WebhookServer } from '../../src/gateway/webhook-server.js';
import { registerEchoHandler } from '../../src/core/handlers/echo-handler.js';
import { fakeClient } from '../helpers/fixtures.js';
import type { FakeClient } from '../helpers/fixtures.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';

let client: FakeClient;
let server: WebhookServer;

beforeAll(() => {
  runSqliteMigrations();
});

beforeEach(async () => {
  client = fakeClient();
  const bus = new EventBus();
  registerEchoHandler(bus);
  const gateway = new CaspianGateway({
    client,
    bus,
    enabledChannels: ['github'],
    webhookSecret: 'whsec_test',
  });
  server = await createWebhookServer({ gateway, port: 0, path: '/webhooks/caspian' });
});

afterEach(async () => {
  await server.close();
});

describe('GET /analytics (#24)', () => {
  it('serves a JSON issue analytics summary', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/analytics`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');

    const body = await response.json();
    expect(body).toHaveProperty('totalConversations');
    expect(body).toHaveProperty('escalationRate');
    expect(body).toHaveProperty('humanHandoffRate');
    expect(body).toHaveProperty('conversationsWithOpenTriage');
    expect(body).toHaveProperty('averageTimeToFirstResponseMs');
  });

  it('accepts a custom since date via query param', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/analytics?since=2020-01-01`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sinceISODate).toBe('2020-01-01');
  });
});
