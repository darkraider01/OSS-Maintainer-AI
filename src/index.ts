import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { CaspianGateway } from './gateway/caspian-gateway.js';
import { createCommClient } from './gateway/caspian/client.js';
import { EventBus } from './gateway/event-bus.js';
import { createWebhookServer } from './gateway/webhook-server.js';
import type { WebhookServer } from './gateway/webhook-server.js';
import { DeduplicationService } from './gateway/adapters/deduplication-service.js';
import { ConversationService } from './gateway/adapters/conversation-service.js';
import { IdentityService } from './gateway/adapters/identity-service.js';
import { MessagePersistenceService } from './gateway/adapters/message-persistence-service.js';
import { CommunicationService } from './gateway/adapters/communication-service.js';
import { Runtime as AgentRuntime } from './core/runtime.js';

export interface Runtime {
  bus: EventBus;
  gateway: CaspianGateway;
  agentRuntime: AgentRuntime;
  webhookServer?: WebhookServer;
  shutdown(): Promise<void>;
}

/**
 * Wire Caspian ingress to the internal event bus.
 *
 * FR-1: messages arrive through Caspian (GitHub is the first channel), get
 * normalized into the Unified Event Model, and a reply goes back out on the
 * same conversation.
 */
export async function bootstrap(options?: { client?: any }): Promise<Runtime> {
  logger.info(
    {
      env: env.NODE_ENV,
      ingress: env.CASPIAN_INGRESS_MODE,
      channels: env.CASPIAN_ENABLED_CHANNELS,
    },
    'Bootstrapping OSS-Maintainer-AI Core Engine...'
  );

  const client = options?.client || createCommClient();
  const bus = new EventBus();

  const dedupService = new DeduplicationService();
  const convService = new ConversationService();
  const identityService = new IdentityService();
  const persistenceService = new MessagePersistenceService();

  const commService = new CommunicationService(
    dedupService,
    convService,
    identityService,
    persistenceService,
    async (envelope) => {
      envelope.respond = async (text: string) => {
        await client.reply(envelope.payload.providerEventId, text);
      };
      await bus.publish(envelope as any);
    }
  );

  const gateway = new CaspianGateway({
    client,
    bus,
    enabledChannels: env.CASPIAN_ENABLED_CHANNELS,
    webhookSecret: env.CASPIAN_WEBHOOK_SECRET,
    communicationService: commService,
  });

  const agentRuntime = new AgentRuntime({
    demoMode: env.DEMO_MODE,
    apiKey: env.LLM_API_KEY,
    provider: env.LLM_PROVIDER,
  });

  bus.subscribe(async (envelope) => {
    if (envelope.payload) {
      await agentRuntime.processEvent(envelope);
    }
  });

  // Webhook mode reaches the gateway through HTTP, so no SDK handler is attached.
  if (env.CASPIAN_INGRESS_MODE === 'poll') gateway.start();

  const controller = new AbortController();
  let webhookServer: WebhookServer | undefined;

  // Tests stop here: the transport is what needs a live gateway, not the wiring.
  if (env.NODE_ENV !== 'test' && !env.DEMO_MODE) {
    if (env.CASPIAN_INGRESS_MODE === 'webhook') {
      webhookServer = await createWebhookServer({
        gateway,
        port: env.PORT,
        path: env.CASPIAN_WEBHOOK_PATH,
      });
    } else {
      // Runs until the signal aborts; failures surface to the caller.
      void gateway.listen({ signal: controller.signal }).catch((error) => {
        logger.error({ err: error }, 'Caspian listen loop stopped');
      });
    }
  }

  return {
    bus,
    gateway,
    agentRuntime,
    webhookServer,
    shutdown: async () => {
      controller.abort();
      await webhookServer?.close();
      logger.info('Shutdown complete');
    },
  };
}

// Auto-run if executed directly, avoiding execution in test context
if (process.env.NODE_ENV !== 'test' && !env.DEMO_MODE) {
  bootstrap()
    .then((runtime) => {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => {
          logger.info({ signal }, 'Received shutdown signal');
          void runtime.shutdown().finally(() => process.exit(0));
        });
      }
    })
    .catch((err) => {
      logger.error(err, 'Fatal bootstrap execution error');
      process.exit(1);
    });
}
