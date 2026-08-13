import { db } from '../../db/client.js';
import { conversationChannelMappings } from '../../db/schema/conversation_channel_mappings.js';
import { conversations } from '../../db/schema/conversations.js';
import { eq, and } from 'drizzle-orm';
import type { IConversationService, ConversationContext } from './communication-types.js';
import type { ProviderKey } from '../unified-event.js';
import { logger } from '../../config/logger.js';
import { randomUUID } from 'crypto';

/**
 * Postgres (`unique_violation`) and better-sqlite3 (`SQLITE_CONSTRAINT_*`)
 * both surface a unique-index conflict differently — this covers both so
 * `resolveOrCreate` can treat "someone else just created this mapping" as a
 * normal outcome instead of an unhandled error.
 */
function isUniqueConstraintError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === '23505' || (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT'));
}

export class ConversationService implements IConversationService {
  async resolveOrCreate(
    params: {
      provider: ProviderKey;
      channelType: string;
      externalThreadId: string;
      repositoryId?: string | null;
      metadata?: Record<string, unknown>;
    },
    correlationId?: string
  ): Promise<ConversationContext> {
    const log = logger.child({ correlationId, provider: params.provider });
    log.debug({ externalThreadId: params.externalThreadId }, 'Resolving conversation mapping');

    const findExisting = () =>
      db
        .select()
        .from(conversationChannelMappings)
        .where(
          and(
            eq(conversationChannelMappings.provider, params.provider as any),
            eq(conversationChannelMappings.channelType, params.channelType),
            eq(conversationChannelMappings.externalThreadId, params.externalThreadId)
          )
        );

    // 1. Search for existing mapping
    const [existing] = await findExisting();

    if (existing) {
      log.debug({ conversationId: existing.conversationId }, 'Found existing conversation mapping');
      return {
        conversationId: existing.conversationId,
        providerThreadId: params.externalThreadId,
        providerChannelId: params.channelType,
        conversationType: params.channelType,
        participants: [],
        createdAt: existing.createdAt.toISOString(),
      };
    }

    // 2. Create new conversation
    log.info('Creating new conversation for channel mapping');
    const now = new Date();
    const [newConversation] = await db
      .insert(conversations)
      .values({
        id: randomUUID(),
        repositoryId: params.repositoryId || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // 3. Map conversation. The step-1 check and this insert aren't atomic, so
    // a second caller resolving the same external thread concurrently can
    // reach here too — the unique index added alongside this fix turns that
    // into a constraint violation instead of a silent duplicate row. Treat
    // it as "the other caller won" and return its mapping; `newConversation`
    // becomes an unreferenced-but-harmless orphan (nothing looks it up
    // without going through this table first).
    try {
      await db.insert(conversationChannelMappings).values({
        id: randomUUID(),
        conversationId: newConversation.id,
        provider: params.provider as any,
        channelType: params.channelType,
        externalThreadId: params.externalThreadId,
        metadata: params.metadata || null,
        createdAt: now,
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      log.debug('Lost the race to map this external thread; using the winning mapping');
      const [winner] = await findExisting();
      if (!winner) throw error;
      return {
        conversationId: winner.conversationId,
        providerThreadId: params.externalThreadId,
        providerChannelId: params.channelType,
        conversationType: params.channelType,
        participants: [],
        createdAt: winner.createdAt.toISOString(),
      };
    }

    log.info({ conversationId: newConversation.id }, 'Successfully mapped new conversation');

    return {
      conversationId: newConversation.id,
      providerThreadId: params.externalThreadId,
      providerChannelId: params.channelType,
      conversationType: params.channelType,
      participants: [],
      createdAt: newConversation.createdAt.toISOString(),
    };
  }
}
