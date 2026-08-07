import { logger } from '../config/logger.js';
import type { EventEnvelope } from './unified-event.js';

export type EventSubscriber = (envelope: any) => void | Promise<void>;

/**
 * The internal event bus every adapter publishes to.
 *
 * In-process for now; the interface is deliberately narrow so it can be swapped
 * for a durable queue without touching adapters or subscribers (ADR-0004).
 */
export class EventBus {
  private readonly subscribers: EventSubscriber[] = [];

  subscribe(subscriber: EventSubscriber): () => void {
    this.subscribers.push(subscriber);
    return () => {
      const index = this.subscribers.indexOf(subscriber);
      if (index >= 0) this.subscribers.splice(index, 1);
    };
  }

  /**
   * Deliver to every subscriber. A throwing subscriber is logged and skipped so
   * one bad handler can never stall ingress.
   */
  async publish(envelope: EventEnvelope): Promise<void> {
    for (const subscriber of this.subscribers) {
      try {
        await subscriber(envelope);
      } catch (error) {
        logger.error(
          { err: error, eventId: envelope.event?.id || (envelope as any).eventId || 'unknown' },
          'Event subscriber failed; continuing'
        );
      }
    }
  }

  get size(): number {
    return this.subscribers.length;
  }
}
