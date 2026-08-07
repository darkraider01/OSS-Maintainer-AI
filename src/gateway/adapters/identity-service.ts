import { db } from '../../db/client.js';
import { actors } from '../../db/schema/actors.js';
import { actorAccounts } from '../../db/schema/actor_accounts.js';
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
}
