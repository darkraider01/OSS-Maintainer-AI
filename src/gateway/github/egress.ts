import type { GitHubClientLike, GitHubComment } from './client.js';

export interface GitHubReplyTarget {
  owner: string;
  repo: string;
  issueNumber: number;
}

/** Pulls the owner/repo/issue number the adapter stashed in `UnifiedEvent.metadata.github`. */
export function extractGitHubReplyTarget(
  metadata: Record<string, unknown>
): GitHubReplyTarget | null {
  const github = metadata.github as
    { owner?: string; repo?: string; issueNumber?: number } | undefined;
  if (!github?.owner || !github?.repo || typeof github.issueNumber !== 'number') return null;
  return { owner: github.owner, repo: github.repo, issueNumber: github.issueNumber };
}

/** Posts the agent's formatted reply as an issue/PR comment via the GitHub App client. */
export function postGitHubReply(
  client: GitHubClientLike,
  target: GitHubReplyTarget,
  text: string
): Promise<GitHubComment> {
  return client.postIssueComment(target.owner, target.repo, target.issueNumber, text);
}
