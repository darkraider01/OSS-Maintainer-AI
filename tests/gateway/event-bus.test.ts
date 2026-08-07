import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/gateway/event-bus.js';
import { githubAdapter } from '../../src/gateway/adapters/github.js';
import type { EventEnvelope } from '../../src/gateway/unified-event.js';
import { inboundMessage } from '../helpers/fixtures.js';

function envelope(): EventEnvelope {
  return { event: githubAdapter.normalize(inboundMessage()), respond: async () => {} };
}

describe('EventBus', () => {
  it('delivers to every subscriber', async () => {
    const bus = new EventBus();
    const first = vi.fn();
    const second = vi.fn();
    bus.subscribe(first);
    bus.subscribe(second);

    await bus.publish(envelope());

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('stops delivering after unsubscribe', async () => {
    const bus = new EventBus();
    const subscriber = vi.fn();
    const unsubscribe = bus.subscribe(subscriber);

    unsubscribe();
    await bus.publish(envelope());

    expect(subscriber).not.toHaveBeenCalled();
    expect(bus.size).toBe(0);
  });

  it('isolates a throwing subscriber from the rest', async () => {
    const bus = new EventBus();
    const healthy = vi.fn();
    bus.subscribe(() => {
      throw new Error('subscriber exploded');
    });
    bus.subscribe(healthy);

    await expect(bus.publish(envelope())).resolves.toBeUndefined();
    expect(healthy).toHaveBeenCalledOnce();
  });
});
