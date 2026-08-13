import type { PullRequestFileChange } from '../../gateway/github/client.js';

export interface PullRequestSummaryInput {
  title: string;
  body: string | null;
  files: PullRequestFileChange[];
}

export interface PullRequestSummaryResult {
  objective: string;
  changes: string[];
  relatedIssues: string[];
  risks: string[];
  reviewFocus: string[];
  responseText: string;
}
