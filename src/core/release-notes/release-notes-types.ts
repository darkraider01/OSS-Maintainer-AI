import type { ReleaseNoteItem } from '../../gateway/github/client.js';

export type ReleaseNoteCategory =
  | 'Breaking Changes'
  | 'Features'
  | 'Bug Fixes'
  | 'Documentation'
  | 'Improvements'
  | 'Other Changes';

export interface ReleaseNotesInput {
  owner: string;
  repo: string;
  sinceISODate: string;
  mergedPullRequests: ReleaseNoteItem[];
  closedIssues: ReleaseNoteItem[];
}

export interface ReleaseNotesResult {
  categorized: Record<ReleaseNoteCategory, ReleaseNoteItem[]>;
  markdown: string;
}
