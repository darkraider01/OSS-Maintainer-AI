import { db } from '../../db/client.js';
import { messages } from '../../db/schema/messages.js';
import type { IMessagePersistenceService, EventEnvelope } from './communication-types.js';
import { logger } from '../../config/logger.js';
import { randomUUID } from 'crypto';

export class MessagePersistenceService implements IMessagePersistenceService {
  async persist(envelope: EventEnvelope): Promise<void> {
    const { payload, correlationId } = envelope;
    logger.debug(
      { correlationId, eventId: envelope.eventId },
      'Persisting normalized message to database'
    );

    await db.insert(messages).values({
      id: randomUUID(),
      conversationId: payload.conversationId,
      senderActorId: payload.actorId,
      content: payload.text || payload.subject || '(empty payload)',
      createdAt: new Date(),
    });

    logger.info(
      { correlationId, eventId: envelope.eventId },
      'Normalized message successfully persisted'
    );
  }
}
