import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { actors } from '../../db/schema/actors.js';
import { actorAccounts } from '../../db/schema/actor_accounts.js';
import { getContributorHistory } from '../knowledge/contributor-history-service.js';
import type { GitHubClientLike } from '../../gateway/github/client.js';
import type { ContributorProfile } from './contributor-profile-types.js';

/**
 * Contributor Profiles (#22, nice-to-have). Aggregates existing
 * Actor/ActorAccount/message data the app already collects — no new
 * tracking beyond `actors.onboardedAt` (set by WorkflowEngine when
 * OnboardingWorkflow runs). Deliberately factual: connected accounts,
 * message counts, GitHub activity — no scoring, ranking, or inferred
 * personal characteristics (PRD §15 explicitly prohibits both).
 */
export class ContributorProfileService {
  async build(
    actorId: string,
    options: {
      githubClient?: GitHubClientLike | null;
      repository?: { owner: string; repo: string };
    } = {}
  ): Promise<ContributorProfile | null> {
    const [actor] = await db.select().from(actors).where(eq(actors.id, actorId));
    if (!actor) return null;

    const connectedAccounts = await db
      .select({ provider: actorAccounts.provider, username: actorAccounts.username })
      .from(actorAccounts)
      .where(eq(actorAccounts.actorId, actorId));

    const history = await getContributorHistory(
      actorId,
      options.githubClient ?? null,
      options.repository
    );
    const providerNames: string[] = connectedAccounts.map((a: any) => a.provider as string);
    const channelsUsed: string[] = Array.from(new Set(providerNames));

    return {
      actorId,
      firstSeenAt: actor.createdAt.toISOString(),
      onboardedAt: actor.onboardedAt ? actor.onboardedAt.toISOString() : null,
      connectedAccounts,
      messagesSent: history.messagesSent,
      channelsUsed,
      githubActivity: options.repository
        ? { issuesOpened: history.issuesOpened, pullRequestsOpened: history.pullRequestsOpened }
        : null,
    };
  }

  /** Marks that OnboardingWorkflow just ran for this actor — the only write this service performs. */
  async recordOnboarded(actorId: string): Promise<void> {
    await db
      .update(actors)
      .set({ onboardedAt: new Date(), updatedAt: new Date() })
      .where(eq(actors.id, actorId));
  }
}

/** Compact, single-line prompt context — deliberately terse, this is grounding, not the main content. */
export function formatContributorProfileForPrompt(profile: ContributorProfile | null): string {
  if (!profile) return 'No contributor profile available.';

  const parts = [
    profile.messagesSent <= 1
      ? 'first message from this contributor (no prior history)'
      : `${profile.messagesSent} prior messages`,
    profile.onboardedAt ? 'has been onboarded' : 'not yet onboarded',
  ];
  if (profile.githubActivity) {
    parts.push(
      `${profile.githubActivity.issuesOpened} issues / ${profile.githubActivity.pullRequestsOpened} PRs opened in this repo`
    );
  }
  return `Contributor profile: ${parts.join(', ')}.`;
}
