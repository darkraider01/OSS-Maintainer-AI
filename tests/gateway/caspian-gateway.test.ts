import { describe, expect, it, vi } from 'vitest';
import { CaspianGateway } from '../../src/gateway/caspian-gateway.js';
import { EventBus } from '../../src/gateway/event-bus.js';
import { signWebhookPayload } from '../../src/gateway/caspian/webhook-signature.js';
import { WebhookVerificationError } from '../../src/gateway/caspian/webhook-signature.js';
import { registerEchoHandler } from '../../src/core/handlers/echo-handler.js';
import { fakeClient, inboundMessage, messageEvent } from '../helpers/fixtures.js';

const SECRET = 'whsec_test';

function buildGateway(overrides: Record<string, unknown> = {}) {
  const client = fakeClient();
  const bus = new EventBus();
  const gateway = new CaspianGateway({
    client,
    bus,
    enabledChannels: ['github'],
    webhookSecret: SECRET,
    ...overrides,
  });
  return { client, bus, gateway };
}

function signedDelivery(payload: unknown, secret = SECRET) {
  const body = JSON.stringify(payload);
  return { body, headers: { 'x-caspian-signature': signWebhookPayload(body, secret) } };
}

describe('CaspianGateway ingest', () => {
  it('publishes a normalized event for an enabled channel', async () => {
    const { bus, gateway } = buildGateway();
    const subscriber = vi.fn();
    bus.subscribe(subscriber);

    await expect(gateway.ingest(inboundMessage())).resolves.toBe(true);
    expect(subscriber).toHaveBeenCalledOnce();
    expect(subscriber.mock.calls[0][0].event.provider).toBe('github');
  });

  it('drops channels that are not enabled', async () => {
    const { bus, gateway } = buildGateway({ enabledChannels: ['github'] });
    const subscriber = vi.fn();
    bus.subscribe(subscriber);

    await expect(gateway.ingest(inboundMessage({ channel: 'slack' }))).resolves.toBe(false);
    expect(subscriber).not.toHaveBeenCalled();
  });

  it('drops enabled channels that have no adapter', async () => {
    const { gateway } = buildGateway({ enabledChannels: ['github', 'telegram'] });

    await expect(gateway.ingest(inboundMessage({ channel: 'telegram' }))).resolves.toBe(false);
  });

  it('routes a reply back to the originating message', async () => {
    const { client, bus, gateway } = buildGateway();
    bus.subscribe(async (envelope) => envelope.respond('pong'));

    await gateway.ingest(inboundMessage());

    expect(client.replies).toEqual([{ messageId: 'msg_1', text: 'pong' }]);
  });
});

describe('CaspianGateway polling ingress', () => {
  it('registers a single SDK handler and dispatches through it', async () => {
    const { client, bus, gateway } = buildGateway();
    const subscriber = vi.fn();
    bus.subscribe(subscriber);

    gateway.start();
    gateway.start(); // idempotent

    expect(client.handlers).toHaveLength(1);

    await client.handlers[0]({
      id: 'msg_7',
      conversationId: 'conv_7',
      connectionId: 'conn_7',
      customerId: 'cus_7',
      agentId: 'agt_7',
      channel: 'github',
      sender: { login: 'octocat' },
      subject: null,
      text: 'ping',
      html: null,
      media: [],
    });

    expect(subscriber).toHaveBeenCalledOnce();
    expect(subscriber.mock.calls[0][0].event.id).toBe('github:msg_7');
  });
});

describe('CaspianGateway webhook ingress', () => {
  it('accepts a correctly signed delivery', async () => {
    const { bus, gateway } = buildGateway();
    const subscriber = vi.fn();
    bus.subscribe(subscriber);

    const result = await gateway.handleWebhook(signedDelivery(messageEvent()));

    expect(result).toEqual({ status: 'ok', accepted: 1, ignored: 0 });
    expect(subscriber).toHaveBeenCalledOnce();
  });

  it('rejects a delivery with a bad signature', async () => {
    const { gateway } = buildGateway();

    await expect(
      gateway.handleWebhook(signedDelivery(messageEvent(), 'wrong-secret'))
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it('rejects a delivery with no signature header', async () => {
    const { gateway } = buildGateway();

    await expect(
      gateway.handleWebhook({ body: JSON.stringify(messageEvent()), headers: {} })
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it('ignores a redelivery of an event it already processed', async () => {
    const { bus, gateway } = buildGateway();
    const subscriber = vi.fn();
    bus.subscribe(subscriber);

    await gateway.handleWebhook(signedDelivery(messageEvent()));
    const retry = await gateway.handleWebhook(signedDelivery(messageEvent()));

    expect(retry).toEqual({ status: 'ignored', accepted: 0, ignored: 1 });
    expect(subscriber).toHaveBeenCalledOnce();
  });

  it('ignores the same message redelivered under a new event id', async () => {
    const { client, bus, gateway } = buildGateway();
    bus.subscribe(async (envelope) => envelope.respond('pong'));

    await gateway.handleWebhook(signedDelivery(messageEvent()));
    await gateway.handleWebhook(signedDelivery(messageEvent({ id: 'evt_99', seq: 99 })));

    expect(client.replies).toHaveLength(1);
  });

  it('accepts a batch and ignores unrelated event types', async () => {
    const { gateway } = buildGateway();
    const batch = [
      messageEvent(),
      messageEvent({ id: 'evt_2', seq: 2, type: 'reaction.received' }),
    ];

    const result = await gateway.handleWebhook(signedDelivery(batch));

    expect(result).toEqual({ status: 'ok', accepted: 1, ignored: 1 });
  });
});

describe('FR-1 end to end', () => {
  it('receives a GitHub message through Caspian and echoes it back', async () => {
    const { client, bus, gateway } = buildGateway();
    registerEchoHandler(bus);

    await gateway.handleWebhook(signedDelivery(messageEvent()));

    expect(client.replies).toHaveLength(1);
    expect(client.replies[0].messageId).toBe('msg_1');
    expect(client.replies[0].text).toContain('OSS-Maintainer-AI received your message via github');
    expect(client.replies[0].text).toContain('octocat');
    expect(client.replies[0].text).toContain('@oss-maintainer-ai please triage this');
  });
});
