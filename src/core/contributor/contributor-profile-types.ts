export interface ContributorProfile {
  actorId: string;
  firstSeenAt: string;
  /** Last time OnboardingWorkflow ran for this actor, if ever. */
  onboardedAt: string | null;
  connectedAccounts: Array<{ provider: string; username: string }>;
  messagesSent: number;
  /**
   * Providers this actor is known/linked on — a proxy for "channels
   * interacted with". The app doesn't persist per-message provider today
   * (see docs/implementation/remaining-work.md), so this is derived from
   * linked accounts, not message history directly.
   */
  channelsUsed: string[];
  /** Only populated when a specific repository was given — GitHub activity is per-repo, not global. */
  githubActivity: { issuesOpened: number; pullRequestsOpened: number } | null;
}
