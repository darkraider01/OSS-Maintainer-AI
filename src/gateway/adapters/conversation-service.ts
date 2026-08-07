import { db } from '../../db/client.js';
import { conversationChannelMappings } from '../../db/schema/conversation_channel_mappings.js';
import { conversations } from '../../db/schema/conversations.js';
import { eq, and } from 'drizzle-orm';
import type { IConversationService, ConversationContext } from './communication-types.js';
import type { ProviderKey } from '../unified-event.js';
import { logger } from '../../config/logger.js';
import { randomUUID } from 'crypto';

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

    // 1. Search for existing mapping
    const [existing] = await db
      .select()
      .from(conversationChannelMappings)
      .where(
        and(
          eq(conversationChannelMappings.provider, params.provider as any),
          eq(conversationChannelMappings.channelType, params.channelType),
          eq(conversationChannelMappings.externalThreadId, params.externalThreadId)
        )
      );

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

    // 3. Map conversation
    await db.insert(conversationChannelMappings).values({
      id: randomUUID(),
      conversationId: newConversation.id,
      provider: params.provider as any,
      channelType: params.channelType,
      externalThreadId: params.externalThreadId,
      metadata: params.metadata || null,
      createdAt: now,
    });

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
