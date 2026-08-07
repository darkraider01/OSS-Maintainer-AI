import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { registerEchoHandler } from './core/handlers/echo-handler.js';
import { CaspianGateway } from './gateway/caspian-gateway.js';
import { createCommClient } from './gateway/caspian/client.js';
import { EventBus } from './gateway/event-bus.js';
import { createWebhookServer } from './gateway/webhook-server.js';
import type { WebhookServer } from './gateway/webhook-server.js';

export interface Runtime {
  bus: EventBus;
  gateway: CaspianGateway;
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
export async function bootstrap(): Promise<Runtime> {
  logger.info(
    {
      env: env.NODE_ENV,
      ingress: env.CASPIAN_INGRESS_MODE,
      channels: env.CASPIAN_ENABLED_CHANNELS,
    },
    'Bootstrapping OSS-Maintainer-AI Core Engine...'
  );

  const client = createCommClient();
  const bus = new EventBus();
  const gateway = new CaspianGateway({
    client,
    bus,
    enabledChannels: env.CASPIAN_ENABLED_CHANNELS,
    webhookSecret: env.CASPIAN_WEBHOOK_SECRET,
  });

  registerEchoHandler(bus);
  // Webhook mode reaches the gateway through HTTP, so no SDK handler is attached.
  if (env.CASPIAN_INGRESS_MODE === 'poll') gateway.start();

  const controller = new AbortController();
  let webhookServer: WebhookServer | undefined;

  // Tests stop here: the transport is what needs a live gateway, not the wiring.
  if (env.NODE_ENV !== 'test') {
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
    webhookServer,
    shutdown: async () => {
      controller.abort();
      await webhookServer?.close();
      logger.info('Shutdown complete');
    },
  };
}

// Auto-run if executed directly, avoiding execution in test context
if (process.env.NODE_ENV !== 'test') {
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
