import type { Connection } from 'caspian-sdk';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { createCommClient } from '../gateway/caspian/client.js';

/** PEM keys are usually stored with escaped newlines in `.env`. */
function normalizePrivateKey(key: string): string {
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

function hasByoAppCredentials(): boolean {
  return Boolean(
    env.GITHUB_APP_ID && env.GITHUB_APP_SLUG && env.GITHUB_PRIVATE_KEY && env.GITHUB_WEBHOOK_SECRET
  );
}

/**
 * Provision the GitHub channel on Caspian (FR-1, step 1).
 *
 * With `GITHUB_APP_ID` / `GITHUB_APP_SLUG` / `GITHUB_PRIVATE_KEY` /
 * `GITHUB_WEBHOOK_SECRET` set, this installs your own GitHub App. With none of
 * them set, it uses the gateway's shared App (one-click install).
 *
 * Both paths return an `authorize_url` — open it to finish the install on
 * GitHub. Nothing is provisioned until a human approves it there.
 */
export async function connectGitHubChannel(): Promise<Connection> {
  const client = createCommClient();

  const connection = hasByoAppCredentials()
    ? await client.connectGitHub({
        githubAppId: env.GITHUB_APP_ID as string,
        githubAppSlug: env.GITHUB_APP_SLUG as string,
        githubPrivateKey: normalizePrivateKey(env.GITHUB_PRIVATE_KEY as string),
        githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET as string,
        receiveMode: env.GITHUB_RECEIVE_MODE,
        displayName: 'OSS-Maintainer-AI',
      })
    : await client.installGitHub({
        displayName: 'OSS-Maintainer-AI',
        receiveMode: env.GITHUB_RECEIVE_MODE,
      });

  logger.info(
    {
      connectionId: connection.id,
      status: connection.status,
      mode: hasByoAppCredentials() ? 'bring-your-own-app' : 'shared-app-install',
      receiveMode: env.GITHUB_RECEIVE_MODE,
    },
    'GitHub connection created'
  );

  if (connection.authorize_url) {
    logger.info(
      { authorizeUrl: connection.authorize_url },
      'Open this URL to install the App on your repositories'
    );
  }

  // Push ingress needs the gateway to know where to deliver, and with what secret.
  if (env.CASPIAN_INGRESS_MODE === 'webhook' && env.CASPIAN_WEBHOOK_URL) {
    await client.setWebhook(env.CASPIAN_WEBHOOK_URL, env.CASPIAN_WEBHOOK_SECRET);
    logger.info({ url: env.CASPIAN_WEBHOOK_URL }, 'Registered webhook delivery URL');
  }

  return connection;
}

// Run when invoked directly (`pnpm caspian:connect-github`).
if (process.env.NODE_ENV !== 'test') {
  connectGitHubChannel().catch((error) => {
    logger.error({ err: error }, 'Failed to connect the GitHub channel');
    process.exit(1);
  });
}
