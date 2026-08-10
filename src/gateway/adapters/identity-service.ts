import { db } from '../../db/client.js';
import { actors } from '../../db/schema/actors.js';
import { actorAccounts } from '../../db/schema/actor_accounts.js';
import { messages } from '../../db/schema/messages.js';
import { eq, and } from 'drizzle-orm';
import type { IIdentityService } from './communication-types.js';
import type { ProviderKey } from '../unified-event.js';
import { logger } from '../../config/logger.js';
import { randomUUID } from 'crypto';

export class IdentityService implements IIdentityService {
  private cache = new Map<string, string>(); // providerUserId -> actorId

  async resolveActor(
    params: {
      provider: ProviderKey;
      providerUserId: string;
      username: string;
      displayName?: string | null;
      avatarUrl?: string | null;
      email?: string | null;
    },
    correlationId?: string
  ): Promise<string> {
    const cacheKey = `${params.provider}:${params.providerUserId}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const log = logger.child({ correlationId, provider: params.provider });
    log.debug({ providerUserId: params.providerUserId }, 'Resolving actor identity');

    // 1. Search for existing account mapping
    const [existing] = await db
      .select()
      .from(actorAccounts)
      .where(
        and(
          eq(actorAccounts.provider, params.provider as any),
          eq(actorAccounts.providerUserId, params.providerUserId)
        )
      );

    if (existing) {
      this.cache.set(cacheKey, existing.actorId);
      return existing.actorId;
    }

    // 2. Create parent actor
    log.info('Creating new parent actor record');
    const now = new Date();
    const [newActor] = await db
      .insert(actors)
      .values({
        id: randomUUID(),
        type: 'human',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // 3. Register provider account mapping
    await db.insert(actorAccounts).values({
      id: randomUUID(),
      actorId: newActor.id,
      provider: params.provider as any,
      providerUserId: params.providerUserId,
      username: params.username,
      email: params.email || null,
      avatarUrl: params.avatarUrl || null,
      createdAt: now,
      updatedAt: now,
    });

    log.info({ actorId: newActor.id }, 'Registered actor identity mapping');
    this.cache.set(cacheKey, newActor.id);
    return newActor.id;
  }

  async isSelfEvent(
    provider: ProviderKey,
    providerUserId: string,
    correlationId?: string
  ): Promise<boolean> {
    // Lookup if the actor is registered as an agent or bot in actors table
    const [account] = await db
      .select({ type: actors.type })
      .from(actorAccounts)
      .innerJoin(actors, eq(actorAccounts.actorId, actors.id))
      .where(
        and(
          eq(actorAccounts.provider, provider as any),
          eq(actorAccounts.providerUserId, providerUserId)
        )
      );

    const isSelf = account ? account.type === 'agent' || account.type === 'bot' : false;
    logger.debug({ correlationId, provider, providerUserId, isSelf }, 'Self-event detection check');
    return isSelf;
  }

  /**
   * Attach a provider identity to `targetActorId` — the cross-channel-identity
   * counterpart to `resolveActor`, used by the account-linking dashboard.
   *
   * If the provider identity isn't known yet, it's simply added to the target
   * actor. If it already belongs to a *different* actor, that actor is merged
   * into the target: its other provider accounts and message history move
   * over, and the now-empty source actor is deleted. Refuses to merge a
   * bot/agent actor into a human one.
   */
  async linkProviderToActor(
    targetActorId: string,
    params: {
      provider: ProviderKey;
      providerUserId: string;
      username: string;
      displayName?: string | null;
      avatarUrl?: string | null;
      email?: string | null;
    },
    correlationId?: string
  ): Promise<{ actorId: string; merged: boolean }> {
    const log = logger.child({ correlationId, provider: params.provider, targetActorId });

    // Note: deliberately not wrapped in `db.transaction()` — the better-sqlite3
    // driver (used for local/test) requires transaction callbacks to be fully
    // synchronous, which an async/await sequence of drizzle queries can't be.
    // Nothing else in this codebase uses `db.transaction()` either; every other
    // multi-step write (including `resolveActor` above) is plain sequential
    // awaited queries, so this matches the established convention.
    const [existing] = await db
      .select()
      .from(actorAccounts)
      .where(
        and(
          eq(actorAccounts.provider, params.provider as any),
          eq(actorAccounts.providerUserId, params.providerUserId)
        )
      );

    if (!existing) {
      const now = new Date();
      await db.insert(actorAccounts).values({
        id: randomUUID(),
        actorId: targetActorId,
        provider: params.provider as any,
        providerUserId: params.providerUserId,
        username: params.username,
        email: params.email || null,
        avatarUrl: params.avatarUrl || null,
        createdAt: now,
        updatedAt: now,
      });
      log.info('Linked new provider account to actor');
      this.cache.set(`${params.provider}:${params.providerUserId}`, targetActorId);
      return { actorId: targetActorId, merged: false };
    }

    if (existing.actorId === targetActorId) {
      log.debug('Provider account already linked to this actor');
      return { actorId: targetActorId, merged: false };
    }

    const sourceActorId = existing.actorId;
    const [sourceActor] = await db.select().from(actors).where(eq(actors.id, sourceActorId));
    if (sourceActor && (sourceActor.type === 'agent' || sourceActor.type === 'bot')) {
      log.warn({ sourceActorId }, 'Refusing to merge a bot/agent actor into a human actor');
      return { actorId: targetActorId, merged: false };
    }

    log.info({ sourceActorId }, 'Merging provider account into target actor');
    await db
      .update(actorAccounts)
      .set({ actorId: targetActorId })
      .where(eq(actorAccounts.actorId, sourceActorId));
    await db
      .update(messages)
      .set({ senderActorId: targetActorId })
      .where(eq(messages.senderActorId, sourceActorId));
    await db.delete(actors).where(eq(actors.id, sourceActorId));

    // Any cached provider->actorId entries pointing at the now-deleted source are stale.
    this.cache.clear();
    log.info({ sourceActorId, targetActorId }, 'Actor merge complete');
    return { actorId: targetActorId, merged: true };
  }
}
