import { randomUUID } from 'crypto';
import { and, eq, lte } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { pendingDeliveries } from '../../db/schema/pending_deliveries.js';
import type { ProviderKey } from '../../gateway/unified-event.js';

export interface PendingDeliveryRecord {
  id: string;
  provider: ProviderKey;
  conversationId: string;
  target: Record<string, unknown>;
  text: string;
  attempts: number;
}

/**
 * Durable retry queue storage (#27). `DeliveryRecoveryWorker` is the only
 * caller that should read `dueForRetry` — this class is just persistence.
 */
export class PendingDeliveryStore {
  async enqueue(params: {
    provider: ProviderKey;
    conversationId: string;
    target: Record<string, unknown>;
    text: string;
    error: string;
  }): Promise<void> {
    const now = new Date();
    await db.insert(pendingDeliveries).values({
      id: randomUUID(),
      provider: params.provider as any,
      conversationId: params.conversationId,
      target: params.target,
      text: params.text,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      lastError: params.error,
      createdAt: now,
      updatedAt: now,
    });
  }

  async dueForRetry(now: Date = new Date()): Promise<PendingDeliveryRecord[]> {
    const rows = await db
      .select()
      .from(pendingDeliveries)
      .where(
        and(eq(pendingDeliveries.status, 'pending'), lte(pendingDeliveries.nextAttemptAt, now))
      );

    return (rows as any[]).map((row) => ({
      id: row.id,
      provider: row.provider,
      conversationId: row.conversationId,
      target: row.target,
      text: row.text,
      attempts: row.attempts,
    }));
  }

  async markDelivered(id: string): Promise<void> {
    await db
      .update(pendingDeliveries)
      .set({ status: 'delivered', updatedAt: new Date() })
      .where(eq(pendingDeliveries.id, id));
  }

  async markRetried(
    id: string,
    attempts: number,
    nextAttemptAt: Date,
    error: string
  ): Promise<void> {
    await db
      .update(pendingDeliveries)
      .set({ attempts, nextAttemptAt, lastError: error, updatedAt: new Date() })
      .where(eq(pendingDeliveries.id, id));
  }

  async markFailed(id: string, error: string): Promise<void> {
    await db
      .update(pendingDeliveries)
      .set({ status: 'failed', lastError: error, updatedAt: new Date() })
      .where(eq(pendingDeliveries.id, id));
  }
}
