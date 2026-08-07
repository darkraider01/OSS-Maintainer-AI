import { beforeEach, describe, expect, it, vi } from 'vitest';

const replies: Array<{ messageId: string; text: string }> = [];
const handlers: Array<(message: any) => void | Promise<void>> = [];

// Mock Caspian SDK CommClient
vi.mock('caspian-sdk', () => {
  class CommClient {
    onMessage(handler: (message: any) => void | Promise<void>) {
      handlers.push(handler);
      return handler;
    }
    async reply(messageId: string, text?: string | null) {
      replies.push({ messageId, text: text ?? '' });
      return {};
    }
    async listen() {}
  }
  return { CommClient };
});

const { bootstrap } = await import('../src/index.js');

describe('OSS-Maintainer-AI Core Bootstrap', () => {
  beforeEach(() => {
    replies.length = 0;
    handlers.length = 0;
  });

  it('wires Caspian ingress to the event bus', async () => {
    const runtime = await bootstrap();

    expect(runtime.gateway).toBeDefined();
    expect(runtime.bus.size).toBe(1); // the echo handler
    expect(handlers).toHaveLength(1);

    await runtime.shutdown();
  });

  it('echoes a GitHub message back through Caspian (FR-1)', async () => {
    const runtime = await bootstrap();

    await handlers[0]({
      id: 'msg_1',
      conversationId: 'conv_1',
      connectionId: 'conn_1',
      customerId: 'cus_1',
      agentId: 'agt_1',
      channel: 'github',
      sender: { login: 'octocat' },
      subject: 'darkraider01/OSS-Maintainer-AI#4',
      text: 'hello there',
      html: null,
      media: [],
    });

    expect(replies).toHaveLength(1);
    expect(replies[0].messageId).toBe('msg_1');
    expect(replies[0].text).toContain('hello there');

    await runtime.shutdown();
  });

  it('does not start a transport in test mode', async () => {
    const runtime = await bootstrap();

    expect(runtime.webhookServer).toBeUndefined();

    await runtime.shutdown();
  });
});
