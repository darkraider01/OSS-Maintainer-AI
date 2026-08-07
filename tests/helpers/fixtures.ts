import type { InboundMessage } from '../../src/gateway/caspian/inbound-message.js';
import type { CaspianClientLike } from '../../src/gateway/caspian-gateway.js';

export function inboundMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  const base: InboundMessage = {
    id: 'msg_1',
    conversationId: 'conv_1',
    connectionId: 'conn_1',
    customerId: 'cus_1',
    agentId: 'agt_1',
    channel: 'github',
    sender: { id: '4242', login: 'octocat', display_name: 'The Octocat' },
    subject: 'darkraider01/OSS-Maintainer-AI#4',
    text: '@oss-maintainer-ai please triage this',
    html: null,
    raw: {},
  };
  return { ...base, ...overrides };
}

/** A `message.received` event exactly as the gateway delivers it. */
export function messageEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt_1',
    seq: 1,
    type: 'message.received',
    data: {
      customer_id: 'cus_1',
      agent_id: 'agt_1',
      message: {
        id: 'msg_1',
        conversation_id: 'conv_1',
        connection_id: 'conn_1',
        channel: 'github',
        sender: { id: '4242', login: 'octocat' },
        subject: 'darkraider01/OSS-Maintainer-AI#4',
        text: '@oss-maintainer-ai please triage this',
        html: null,
        created_at: '2026-08-07T10:00:00.000Z',
      },
    },
    ...overrides,
  };
}

export interface FakeClient extends CaspianClientLike {
  replies: Array<{ messageId: string; text: string }>;
  handlers: Array<(message: any) => void | Promise<void>>;
  listenCalls: number;
}

/** Stand-in for `CommClient` — records replies so egress can be asserted. */
export function fakeClient(): FakeClient {
  const replies: FakeClient['replies'] = [];
  const handlers: FakeClient['handlers'] = [];

  return {
    replies,
    handlers,
    listenCalls: 0,
    onMessage(handler) {
      handlers.push(handler);
      return handler;
    },
    async reply(messageId: string, text?: string | null) {
      replies.push({ messageId, text: text ?? '' });
      return {};
    },
    async listen() {
      this.listenCalls += 1;
    },
  };
}
