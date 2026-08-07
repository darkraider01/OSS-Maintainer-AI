import { PLATFORM_LIMITS } from '../../config/constants.js';
import { logger } from '../../config/logger.js';
import type { EventBus, EventSubscriber } from '../../gateway/event-bus.js';
import type { EventEnvelope } from '../../gateway/unified-event.js';
import { truncateText } from '../../shared/index.js';

/** Reply prefix, so an echo is unmistakable in a real GitHub thread. */
const ECHO_PREFIX = 'OSS-Maintainer-AI received your message';

export function formatEcho(envelope: EventEnvelope): string {
  const { event } = envelope;
  const actor = event.actorReference.handle ?? event.actorReference.displayName ?? 'unknown sender';
  const body = event.text ?? event.subject ?? '(no text content)';

  return truncateText(
    [
      `${ECHO_PREFIX} via ${event.provider}.`,
      `Sender: ${actor}`,
      `Type: ${event.payloadType}`,
      '',
      `> ${body}`,
    ].join('\n'),
    PLATFORM_LIMITS.MAX_MESSAGE_LENGTH
  );
}

/**
 * The FR-1 end-to-end proof: a message arrives through Caspian, is normalized
 * onto the event bus, and an echo goes back out on the same channel.
 *
 * This is the placeholder the orchestrator replaces once agent routing lands.
 */
export const echoHandler: EventSubscriber = async (envelope) => {
  await envelope.respond(formatEcho(envelope));
  logger.info(
    {
      eventId: envelope.event.id,
      conversationId: envelope.event.conversationReference.conversationId,
    },
    'Echo reply sent through Caspian'
  );
};

export function registerEchoHandler(bus: EventBus): () => void {
  return bus.subscribe(echoHandler);
}
