import type { AgentContext, AgentResponse } from '../../agent/agent-types.js';
import type { IntentClassificationResult } from '../../intent/intent-types.js';
import type { Workflow } from '../workflow-types.js';
import type { GitHubClientLike } from '../../../gateway/github/client.js';

const NO_REPO_CONTEXT_RESPONSE = [
  "I'd like to help you get started contributing, but I don't have this repository's documentation available right now.",
  "I don't want to invent setup steps I can't confirm — please check the repository's README and CONTRIBUTING.md directly, and look for issues labeled `good first issue`.",
].join('\n');

/**
 * Contributor Onboarding (#19). Retrieves README/CONTRIBUTING.md and
 * good-first-issue items via the existing GitHub client rather than
 * hallucinating them — if nothing is available, says so explicitly per
 * PRD §8 instead of inventing instructions.
 */
export class OnboardingWorkflow implements Workflow {
  readonly name = 'onboarding-workflow';

  constructor(private readonly githubClient: GitHubClientLike | null) {}

  async execute(
    context: AgentContext,
    classification: IntentClassificationResult
  ): Promise<AgentResponse> {
    const repo = context.repositoryContext;
    if (!repo || !this.githubClient) {
      return {
        text: NO_REPO_CONTEXT_RESPONSE,
        confidence: Math.min(classification.confidence, 0.5),
        actions: [],
        artifacts: [],
        metadata: { docsFound: false, reason: 'no_repository_context' },
      };
    }

    const [docs, goodFirstIssues] = await Promise.all([
      this.githubClient.getRepositoryDocs(repo.owner, repo.repositoryName),
      this.githubClient.listGoodFirstIssues(repo.owner, repo.repositoryName),
    ]);

    const readme = docs.find((d) => /readme/i.test(d.path));
    const contributing = docs.find((d) => /contributing/i.test(d.path));

    const lines: string[] = [
      `Welcome! Here's how to get started contributing to ${repo.owner}/${repo.repositoryName}:`,
      '',
      contributing
        ? `**Contribution guidelines:** see \`${contributing.path}\` — please read it before opening a PR.`
        : '**Contribution guidelines:** no CONTRIBUTING.md found in this repository — check the README for contribution notes.',
      readme
        ? `**Setup:** see \`${readme.path}\` for install/build instructions.`
        : "**Setup:** no README found — I can't confirm setup steps for this repository.",
    ];

    if (goodFirstIssues.length > 0) {
      lines.push('**Good first issues:**');
      for (const issue of goodFirstIssues) {
        lines.push(`- #${issue.number} ${issue.title} — ${issue.htmlUrl}`);
      }
    } else {
      lines.push(
        '**Good first issues:** none currently labeled `good first issue` in this repository.'
      );
    }

    lines.push(
      '',
      `Suggested next step: read ${contributing ? `\`${contributing.path}\`` : 'the README'}, then pick one of the issues above — or ask here and I can help point you to one.`
    );

    return {
      text: lines.join('\n'),
      confidence: classification.confidence,
      actions: [],
      artifacts: [],
      metadata: {
        docsFound: docs.length > 0,
        hasContributing: Boolean(contributing),
        hasReadme: Boolean(readme),
        goodFirstIssueCount: goodFirstIssues.length,
      },
    };
  }
}
