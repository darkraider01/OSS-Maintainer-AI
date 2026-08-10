import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitHubGateway } from '../../src/gateway/github-gateway.js';
import { createWebhookServer } from '../../src/gateway/webhook-server.js';
import type { WebhookServer } from '../../src/gateway/webhook-server.js';
import { CaspianGateway } from '../../src/gateway/caspian-gateway.js';
import { EventBus } from '../../src/gateway/event-bus.js';
import { signGitHubPayload } from '../../src/gateway/github/webhook-signature.js';
import type { ICommunicationService } from '../../src/gateway/adapters/communication-types.js';
import type { EventEnvelope } from '../../src/gateway/adapters/communication-types.js';
import { fakeClient, issuesOpenedPayload } from '../helpers/fixtures.js';

const SECRET = 'ghsec_test';
const PATH = '/webhooks/github';

let server: WebhookServer;
let ingestCalls: Array<{ rawMessage: any; provider: string }>;
let ingestResult: EventEnvelope | null;

function stubCommunicationService(): ICommunicationService {
  return {
    ingest: async (rawMessage, provider) => {
      ingestCalls.push({ rawMessage, provider });
      return ingestResult;
    },
  };
}

function fakeEnvelope(): EventEnvelope {
  return {
    eventId: 'github:delivery-1',
    eventType: 'THREAD_CREATED',
    provider: 'github',
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId: 'delivery-1',
    causationId: 'github:delivery-1',
    payload: {
      id: 'github:delivery-1',
      provider: 'github',
      providerEventId: 'delivery-1',
      eventType: 'THREAD_CREATED',
      messageType: 'text',
      occurredAt: new Date().toISOString(),
      actorId: 'actor-1',
      conversationId: 'conversation-1',
      conversationContext: {
        conversationId: 'conversation-1',
        providerThreadId: 'darkraider01/OSS-Maintainer-AI#42',
        providerChannelId: 'issue',
        conversationType: 'issue',
        participants: [],
        createdAt: new Date().toISOString(),
      },
      subject: 'The build fails on Windows',
      text: 'Steps to reproduce...',
      attachments: [],
      mentions: [],
      replyToId: null,
      metadata: {},
      rawPayload: {},
    },
    respond: async () => {},
  };
}

async function post(body: string, signature?: string) {
  return fetch(`http://127.0.0.1:${server.port}${PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-github-event': 'issues',
      'x-github-delivery': 'delivery-1',
      ...(signature ? { 'x-hub-signature-256': signature } : {}),
    },
    body,
  });
}

beforeEach(async () => {
  ingestCalls = [];
  ingestResult = fakeEnvelope();

  const githubGateway = new GitHubGateway({
    communicationService: stubCommunicationService(),
    webhookSecret: SECRET,
    receiveMode: 'all',
  });

  // The generalized server also always carries a Caspian route; a minimal
  // gateway with no channels enabled keeps that route inert for this suite.
  const caspianGateway = new CaspianGateway({
    client: fakeClient(),
    bus: new EventBus(),
    enabledChannels: [],
    webhookSecret: 'unused-in-this-suite',
  });

  server = await createWebhookServer({
    gateway: caspianGateway,
    port: 0,
    path: '/webhooks/caspian',
    github: { gateway: githubGateway, path: PATH },
  });
});

afterEach(async () => {
  await server.close();
});

describe('GitHub webhook server', () => {
  it('accepts a validly signed issues.opened delivery', async () => {
    const body = JSON.stringify(issuesOpenedPayload());
    const response = await post(body, signGitHubPayload(body, SECRET));

    expect(response.status).toBe(200);
    const json = (await response.json()) as { status: string };
    expect(json.status).toBe('accepted');
    expect(ingestCalls).toHaveLength(1);
    expect(ingestCalls[0].provider).toBe('github');
    expect(ingestCalls[0].rawMessage.id).toBe('delivery-1');
  });

  it('rejects a delivery with an invalid signature with 401', async () => {
    const body = JSON.stringify(issuesOpenedPayload());
    const response = await post(body, signGitHubPayload(body, 'wrong-secret'));

    expect(response.status).toBe(401);
    expect(ingestCalls).toHaveLength(0);
  });

  it('rejects a delivery with no signature header with 401', async () => {
    const body = JSON.stringify(issuesOpenedPayload());
    const response = await post(body);

    expect(response.status).toBe(401);
    expect(ingestCalls).toHaveLength(0);
  });

  it('rejects malformed JSON with 400', async () => {
    const body = '{not valid json';
    const response = await post(body, signGitHubPayload(body, SECRET));

    expect(response.status).toBe(400);
    expect(ingestCalls).toHaveLength(0);
  });

  it('rejects an oversized payload with 413 before touching the signature', async () => {
    const hugeBody = JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) });

    const response = await post(hugeBody, 'sha256=irrelevant');

    expect(response.status).toBe(413);
    expect(ingestCalls).toHaveLength(0);
  });

  it('still serves the Caspian route and health check on the same server', async () => {
    const health = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    expect(health.status).toBe(200);
  });
});
