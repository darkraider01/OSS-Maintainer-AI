import type { PullRequestFileChange } from '../../gateway/github/client.js';
import type { PullRequestSummaryInput, PullRequestSummaryResult } from './pr-summary-types.js';

const RELATED_ISSUE_PATTERN = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;

const RISK_RULES: Array<{ label: string; test: (file: PullRequestFileChange) => boolean }> = [
  {
    label: 'Touches database migrations/schema',
    test: (f) => /migrat|schema/i.test(f.filename),
  },
  {
    label: 'Touches CI/workflow configuration',
    test: (f) => /^\.github\/workflows\//i.test(f.filename),
  },
  {
    label: 'Touches dependency manifests/lockfiles',
    test: (f) =>
      /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|requirements\.txt|Cargo\.(toml|lock)|go\.(mod|sum))$/i.test(
        f.filename
      ),
  },
  {
    label: 'Touches auth/security-sensitive code',
    test: (f) => /auth|secret|credential|security/i.test(f.filename),
  },
  {
    label: 'Touches environment/config files',
    test: (f) => /(^|\/)\.env|(^|\/)config[./]/i.test(f.filename),
  },
];

function extractObjective(body: string | null, title: string): string {
  if (!body || body.trim().length === 0) {
    return `No PR description provided — objective inferred from the title only: "${title}"`;
  }
  const firstParagraph = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p.length > 0 && !/^#{1,6}\s/.test(p));
  const text = (firstParagraph ?? body.trim()).replace(/\s+/g, ' ');
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

function extractRelatedIssues(body: string | null): string[] {
  if (!body) return [];
  const matches = new Set<string>();
  for (const match of body.matchAll(RELATED_ISSUE_PATTERN)) {
    matches.add(`#${match[1]}`);
  }
  return [...matches];
}

function summarizeChanges(files: PullRequestFileChange[]): string[] {
  const sorted = [...files].sort((a, b) => b.changes - a.changes);
  const shown = sorted.slice(0, 15);
  const lines = shown.map((f) => `${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`);
  if (sorted.length > shown.length) {
    lines.push(`…and ${sorted.length - shown.length} more file(s)`);
  }
  return lines;
}

function assessRisks(files: PullRequestFileChange[]): string[] {
  const risks: string[] = [];
  for (const rule of RISK_RULES) {
    const matchedFiles = files.filter(rule.test);
    if (matchedFiles.length > 0) {
      risks.push(`${rule.label}: ${matchedFiles.map((f) => f.filename).join(', ')}`);
    }
  }

  const totalChanges = files.reduce((sum, f) => sum + f.changes, 0);
  if (files.length > 15 || totalChanges > 300) {
    risks.push(
      `Large diff (${files.length} files, ${totalChanges} lines changed) — consider splitting or extra review time`
    );
  }

  if (risks.length === 0) {
    risks.push(
      'No risk indicators detected in the changed files — a manual review is still recommended.'
    );
  }
  return risks;
}

function suggestReviewFocus(files: PullRequestFileChange[], risks: string[]): string[] {
  const flaggedFilenames = new Set(
    risks.flatMap((r) => {
      const [, list] = r.split(': ');
      return list ? list.split(', ') : [];
    })
  );
  const byLargestDiff = [...files].sort((a, b) => b.changes - a.changes).slice(0, 3);
  const focusSet = new Set<string>(
    [...flaggedFilenames].filter((f) => files.some((file) => file.filename === f))
  );
  for (const file of byLargestDiff) focusSet.add(file.filename);
  return [...focusSet].slice(0, 5);
}

/**
 * PR Summaries (#21, nice-to-have). Every field here is derived from the
 * actual PR title/body/file list passed in — no fabricated claims about
 * code the diff doesn't show (PRD §13: "do not make claims unsupported by
 * the actual PR diff").
 */
export class PRSummaryService {
  summarize(input: PullRequestSummaryInput): PullRequestSummaryResult {
    const objective = extractObjective(input.body, input.title);
    const changes = summarizeChanges(input.files);
    const relatedIssues = extractRelatedIssues(input.body);
    const risks = assessRisks(input.files);
    const reviewFocus = suggestReviewFocus(input.files, risks);

    const responseText = [
      '## PR Summary',
      '',
      '### Objective',
      objective,
      '',
      '### Changes',
      ...changes.map((c) => `- ${c}`),
      '',
      '### Related Issues',
      ...(relatedIssues.length > 0
        ? relatedIssues.map((i) => `- ${i}`)
        : ['- No linked issues found in the PR description.']),
      '',
      '### Risks',
      ...risks.map((r) => `- ${r}`),
      '',
      '### Review Focus',
      ...(reviewFocus.length > 0
        ? reviewFocus.map((f) => `- ${f}`)
        : ['- No specific files stand out — general review.']),
    ].join('\n');

    return { objective, changes, relatedIssues, risks, reviewFocus, responseText };
  }
}
