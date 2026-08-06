import { CommClient } from 'caspian-sdk';
import { logger } from './config/logger.js';
import { env } from './config/env.js';

export async function bootstrap() {
  logger.info({ env: env.NODE_ENV }, 'Bootstrapping OSS-Maintainer-AI Core Engine...');

  try {
    // Instantiate Caspian Communications Client
    const client = new CommClient();
    logger.info('CommClient successfully initialized.');

    // In a real execution, we'd hook up workflows, connect providers/channels, and register callbacks
    client.onMessage(async (message) => {
      logger.info({ sender: message.sender, text: message.text }, 'Received event via Caspian');
      await message.reply(`OSS-Maintainer-AI: Received message "${message.text}"`);
    });

    logger.info('Ready. Starting Caspian event loop...');
    // We mock/postpone actual listening during bootstrapping tests
    if (env.NODE_ENV !== 'test') {
      await client.listen();
    }
  } catch (error) {
    logger.error(error, 'Fatal bootstrap execution error');
    throw error;
  }
}

// Auto-run if executed directly, avoiding execution in test context
if (process.env.NODE_ENV !== 'test') {
  bootstrap().catch((err) => {
    logger.error(err);
    process.exit(1);
  });
}
