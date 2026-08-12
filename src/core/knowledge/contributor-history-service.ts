import { and, count, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { actorAccounts } from '../../db/schema/actor_accounts.js';
import { messages } from '../../db/schema/messages.js';
import type { GitHubClientLike } from '../../gateway/github/client.js';

export interface ContributorHistory {
  messagesSent: number;
  issuesOpened: number;
  pullRequestsOpened: number;
}

/**
 * "Past questions" (message count) always works — it's a local DB query. Issue/PR
 * counts require a GitHub client and a repo to check against; both are optional so
 * this degrades gracefully (message count only) when GitHub isn't configured.
 */
export async function getContributorHistory(
  actorId: string,
  githubClient: GitHubClientLike | null,
  repository?: { owner: string; repo: string }
): Promise<ContributorHistory> {
  const [messageCountRow] = await db
    .select({ value: count() })
    .from(messages)
    .where(eq(messages.senderActorId, actorId));
  const messagesSent = messageCountRow?.value ?? 0;

  if (!githubClient || !repository) {
    return { messagesSent, issuesOpened: 0, pullRequestsOpened: 0 };
  }

  const [githubAccount] = await db
    .select({ username: actorAccounts.username })
    .from(actorAccounts)
    .where(and(eq(actorAccounts.actorId, actorId), eq(actorAccounts.provider, 'github' as any)));

  if (!githubAccount) {
    return { messagesSent, issuesOpened: 0, pullRequestsOpened: 0 };
  }

  const activity = await githubClient.listContributorActivity(
    repository.owner,
    repository.repo,
    githubAccount.username
  );

  return {
    messagesSent,
    issuesOpened: activity.issuesOpened,
    pullRequestsOpened: activity.pullRequestsOpened,
  };
}
