import { describe, expect, it } from 'vitest';
import { PRSummaryService } from '../../src/core/pr-summary/pr-summary-service.js';
import type { PullRequestFileChange } from '../../src/gateway/github/client.js';

const service = new PRSummaryService();

function file(overrides: Partial<PullRequestFileChange> = {}): PullRequestFileChange {
  return {
    filename: 'src/foo.ts',
    status: 'modified',
    additions: 5,
    deletions: 2,
    changes: 7,
    ...overrides,
  };
}

describe('PRSummaryService', () => {
  it('extracts the objective from the first paragraph of the PR body', () => {
    const result = service.summarize({
      title: 'Fix path handling',
      body: 'This PR fixes the Windows path separator bug.\n\nAlso adds a regression test.',
      files: [file()],
    });
    expect(result.objective).toContain('fixes the Windows path separator bug');
  });

  it('falls back to the title when there is no description, without inventing one', () => {
    const result = service.summarize({ title: 'Fix path handling', body: '', files: [file()] });
    expect(result.objective).toContain('No PR description provided');
    expect(result.objective).toContain('Fix path handling');
  });

  it('extracts related issues referenced with closing keywords', () => {
    const result = service.summarize({
      title: 't',
      body: 'Fixes #42 and closes #7. See also #99 (not auto-linked).',
      files: [file()],
    });
    expect(result.relatedIssues).toContain('#42');
    expect(result.relatedIssues).toContain('#7');
    expect(result.relatedIssues).not.toContain('#99');
  });

  it('reports no linked issues explicitly rather than guessing', () => {
    const result = service.summarize({ title: 't', body: 'No references here.', files: [file()] });
    expect(result.relatedIssues).toHaveLength(0);
    expect(result.responseText).toContain('No linked issues found');
  });

  it('flags migration/schema files as a risk', () => {
    const result = service.summarize({
      title: 't',
      body: 'b',
      files: [file({ filename: 'src/db/migrations/0002_add_column.sql' })],
    });
    expect(result.risks.some((r) => /migration/i.test(r))).toBe(true);
  });

  it('flags CI workflow changes as a risk', () => {
    const result = service.summarize({
      title: 't',
      body: 'b',
      files: [file({ filename: '.github/workflows/ci.yml' })],
    });
    expect(result.risks.some((r) => /CI\/workflow/i.test(r))).toBe(true);
  });

  it('reports no risk indicators explicitly when nothing matches, without claiming the PR is safe', () => {
    const result = service.summarize({
      title: 't',
      body: 'b',
      files: [file({ filename: 'src/ui/Button.tsx' })],
    });
    expect(result.risks).toHaveLength(1);
    expect(result.risks[0]).toContain('No risk indicators detected');
  });

  it('formats the full response using the PRD template sections', () => {
    const result = service.summarize({
      title: 'Add feature',
      body: 'Adds a thing. Fixes #10.',
      files: [file({ filename: 'package.json' })],
    });
    expect(result.responseText).toContain('## PR Summary');
    expect(result.responseText).toContain('### Objective');
    expect(result.responseText).toContain('### Changes');
    expect(result.responseText).toContain('### Related Issues');
    expect(result.responseText).toContain('### Risks');
    expect(result.responseText).toContain('### Review Focus');
  });

  it('does not fabricate changes beyond the provided file list', () => {
    const result = service.summarize({
      title: 't',
      body: 'b',
      files: [file({ filename: 'a.ts' })],
    });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toContain('a.ts');
  });
});
