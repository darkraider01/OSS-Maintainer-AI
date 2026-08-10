import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { actors } from '../../db/schema/actors.js';
import { logger } from '../../config/logger.js';
import type { IIdentityService } from '../adapters/communication-types.js';
import type { GitHubClientLike } from './client.js';

/**
 * Seed the GitHub App's own bot identity as `actors.type = 'bot'` so
 * `IdentityService.isSelfEvent()` recognizes and drops webhook deliveries
 * triggered by the bot's own comments — without any GitHub-specific loop
 * protection. Mirrors the manual actor-type flip the existing Slack test
 * uses (`tests/gateway/slack-adapter.test.ts`), just done once at startup
 * instead of by hand.
 */
export async function ensureGitHubBotActor(
  identityService: IIdentityService,
  client: GitHubClientLike,
  appSlug: string,
  correlationId?: string
): Promise<void> {
  const botLogin = `${appSlug}[bot]`;
  const user = await client.getUserByLogin(botLogin);
  if (!user) {
    logger.warn(
      { botLogin },
      'Could not resolve GitHub bot identity; self-event protection inactive until it can'
    );
    return;
  }

  const actorId = await identityService.resolveActor(
    {
      provider: 'github',
      providerUserId: String(user.id),
      username: user.login,
      displayName: user.login,
      avatarUrl: user.avatarUrl,
      email: null,
    },
    correlationId
  );

  await db.update(actors).set({ type: 'bot' }).where(eq(actors.id, actorId));
  logger.info({ botLogin, actorId }, 'GitHub bot identity seeded for self-event protection');
}
