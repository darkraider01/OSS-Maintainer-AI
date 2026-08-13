import type { AgentContext, AgentResponse } from '../../agent/agent-types.js';
import type { IntentClassificationResult } from '../../intent/intent-types.js';
import type { Workflow } from '../workflow-types.js';
import type { GitHubClientLike } from '../../../gateway/github/client.js';
import { PRSummaryService } from '../../pr-summary/pr-summary-service.js';

interface GitHubEventMetadata {
  owner?: string;
  repo?: string;
  issueNumber?: number;
  kind?: string;
}

/**
 * PR Summaries (#21, nice-to-have). Triggered structurally by
 * MaintainerAgent on a freshly-opened pull request, or by an explicit
 * "summarize this PR" request routed here via intent classification.
 * Always retrieves the actual file diff before writing anything — never
 * summarizes from the title/body alone (PRD §13).
 */
export class PRSummaryWorkflow implements Workflow {
  readonly name = 'pr-summary-workflow';
  private readonly service = new PRSummaryService();

  constructor(private readonly githubClient: GitHubClientLike | null) {}

  async execute(
    context: AgentContext,
    classification: IntentClassificationResult
  ): Promise<AgentResponse> {
    const github = context.event.metadata?.github as GitHubEventMetadata | undefined;

    if (
      !github?.owner ||
      !github?.repo ||
      typeof github.issueNumber !== 'number' ||
      !this.githubClient
    ) {
      return {
        text: "I'd like to summarize this pull request, but I don't have repository access configured right now.",
        confidence: Math.min(classification.confidence, 0.5),
        actions: [],
        artifacts: [],
        metadata: { reason: 'no_repository_access' },
      };
    }

    const files = await this.githubClient.listPullRequestFiles(
      github.owner,
      github.repo,
      github.issueNumber
    );
    if (files.length === 0) {
      return {
        text: "I couldn't retrieve the changed files for this pull request, so I can't produce a grounded summary right now.",
        confidence: 0.4,
        actions: [],
        artifacts: [],
        metadata: { reason: 'no_files_retrieved' },
      };
    }

    const result = this.service.summarize({
      title: context.event.subject ?? 'Untitled pull request',
      body: context.event.text,
      files,
    });

    return {
      text: result.responseText,
      confidence: classification.confidence,
      actions: [],
      artifacts: [{ name: 'pr-summary', content: result.responseText, type: 'summary' }],
      metadata: {
        fileCount: files.length,
        relatedIssueCount: result.relatedIssues.length,
        riskCount: result.risks.length,
      },
    };
  }
}
