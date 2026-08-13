import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaspianGateway } from '../../src/gateway/caspian-gateway.js';
import { EventBus } from '../../src/gateway/event-bus.js';
import { createWebhookServer } from '../../src/gateway/webhook-server.js';
import type { WebhookServer } from '../../src/gateway/webhook-server.js';
import { registerEchoHandler } from '../../src/core/handlers/echo-handler.js';
import { fakeClient } from '../helpers/fixtures.js';
import type { FakeClient } from '../helpers/fixtures.js';
import { metrics } from '../../src/core/observability/metrics.js';

let client: FakeClient;
let server: WebhookServer;

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

describe('GET /metrics (#25)', () => {
  it('serves Prometheus text exposition format', async () => {
    metrics.eventsReceivedTotal.inc({ provider: 'github' });

    const response = await fetch(`http://127.0.0.1:${server.port}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');

    const body = await response.text();
    expect(body).toContain('# TYPE events_received_total counter');
    expect(body).toContain('events_received_total{provider="github"}');
    expect(body).toContain('# TYPE agent_execution_duration_seconds histogram');
  });
});
