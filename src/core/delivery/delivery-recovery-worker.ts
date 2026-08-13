import { logger } from '../../config/logger.js';
import type { ProviderKey } from '../../gateway/unified-event.js';
import type { PendingDeliveryStore } from './pending-delivery-store.js';

export type Deliverer = (target: Record<string, unknown>, text: string) => Promise<void>;

export interface DeliveryRecoveryWorkerOptions {
  maxAttempts?: number;
  /** Backoff in ms for a given (1-indexed) attempt count. Default: 5s, 10s, 20s, ... capped at 30 min. */
  backoffMs?: (attempt: number) => number;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BACKOFF_MS = (attempt: number) => Math.min(30 * 60 * 1000, 5000 * 2 ** attempt);

export interface RecoverySweepResult {
  delivered: number;
  rescheduled: number;
  failed: number;
}

/**
 * Sweeps `pending_deliveries` and retries each due row through the same
 * provider client the original reply would have used. Bounded backoff, then
 * permanently marked failed — no unbounded retry loop (PRD §11: "don't
 * build a complicated distributed system").
 */
export class DeliveryRecoveryWorker {
  private readonly maxAttempts: number;
  private readonly backoffMs: (attempt: number) => number;

  constructor(
    private readonly store: PendingDeliveryStore,
    private readonly deliverers: Partial<Record<ProviderKey, Deliverer>>,
    options: DeliveryRecoveryWorkerOptions = {}
  ) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  }

  async runOnce(now: Date = new Date()): Promise<RecoverySweepResult> {
    const due = await this.store.dueForRetry(now);
    const result: RecoverySweepResult = { delivered: 0, rescheduled: 0, failed: 0 };

    for (const record of due) {
      const deliver = this.deliverers[record.provider];
      if (!deliver) {
        await this.store.markFailed(
          record.id,
          `No deliverer configured for provider "${record.provider}"`
        );
        result.failed += 1;
        continue;
      }

      try {
        await deliver(record.target, record.text);
        await this.store.markDelivered(record.id);
        result.delivered += 1;
        logger.info(
          {
            conversationId: record.conversationId,
            provider: record.provider,
            attempts: record.attempts + 1,
          },
          'Recovered a previously failed delivery'
        );
      } catch (error) {
        const attempts = record.attempts + 1;
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (attempts >= this.maxAttempts) {
          await this.store.markFailed(record.id, errorMessage);
          result.failed += 1;
          logger.error(
            {
              conversationId: record.conversationId,
              provider: record.provider,
              attempts,
              err: error,
            },
            'Delivery permanently failed after exhausting recovery attempts'
          );
        } else {
          await this.store.markRetried(
            record.id,
            attempts,
            new Date(now.getTime() + this.backoffMs(attempts)),
            errorMessage
          );
          result.rescheduled += 1;
        }
      }
    }

    return result;
  }

  /** Starts a periodic sweep. Returns a stop function; the timer is unref'd so it never keeps the process alive on its own. */
  start(intervalMs = 60_000): () => void {
    const timer = setInterval(() => {
      this.runOnce().catch((error) => {
        logger.error({ err: error }, 'Delivery recovery sweep failed unexpectedly');
      });
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}
