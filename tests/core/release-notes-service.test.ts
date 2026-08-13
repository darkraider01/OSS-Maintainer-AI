import { describe, expect, it } from 'vitest';
import { ReleaseNotesService } from '../../src/core/release-notes/release-notes-service.js';
import type { ReleaseNoteItem } from '../../src/gateway/github/client.js';

const service = new ReleaseNotesService();

function item(overrides: Partial<ReleaseNoteItem> = {}): ReleaseNoteItem {
  return {
    number: 1,
    title: 'Some change',
    htmlUrl: 'https://github.com/o/r/pull/1',
    labels: [],
    ...overrides,
  };
}

describe('ReleaseNotesService', () => {
  it('categorizes a PR labeled "bug" as a Bug Fix', () => {
    const result = service.generate({
      owner: 'o',
      repo: 'r',
      sinceISODate: '2026-01-01',
      mergedPullRequests: [item({ number: 10, title: 'Fix crash on startup', labels: ['bug'] })],
      closedIssues: [],
    });
    expect(result.categorized['Bug Fixes']).toHaveLength(1);
    expect(result.categorized['Bug Fixes'][0].number).toBe(10);
  });

  it('categorizes via conventional-commit title prefix when there is no label', () => {
    const result = service.generate({
      owner: 'o',
      repo: 'r',
      sinceISODate: '2026-01-01',
      mergedPullRequests: [item({ title: 'feat: add dark mode' })],
      closedIssues: [],
    });
    expect(result.categorized.Features).toHaveLength(1);
  });

  it('categorizes breaking changes ahead of other matches', () => {
    const result = service.generate({
      owner: 'o',
      repo: 'r',
      sinceISODate: '2026-01-01',
      mergedPullRequests: [item({ title: 'feat!: remove legacy API', labels: ['bug'] })],
      closedIssues: [],
    });
    expect(result.categorized['Breaking Changes']).toHaveLength(1);
    expect(result.categorized['Bug Fixes']).toHaveLength(0);
  });

  it('puts uncategorizable items under Other Changes rather than guessing', () => {
    const result = service.generate({
      owner: 'o',
      repo: 'r',
      sinceISODate: '2026-01-01',
      mergedPullRequests: [item({ title: 'update thing', labels: [] })],
      closedIssues: [],
    });
    expect(result.categorized['Other Changes']).toHaveLength(1);
    expect(result.categorized.Features).toHaveLength(0);
    expect(result.categorized['Bug Fixes']).toHaveLength(0);
  });

  it('references every item by its source PR/issue number and link', () => {
    const result = service.generate({
      owner: 'o',
      repo: 'r',
      sinceISODate: '2026-01-01',
      mergedPullRequests: [
        item({ number: 42, title: 'fix: memory leak', htmlUrl: 'https://x/42' }),
      ],
      closedIssues: [],
    });
    expect(result.markdown).toContain('#42');
    expect(result.markdown).toContain('https://x/42');
  });

  it('omits the Other Changes section entirely when nothing falls into it', () => {
    const result = service.generate({
      owner: 'o',
      repo: 'r',
      sinceISODate: '2026-01-01',
      mergedPullRequests: [item({ title: 'fix: bug', labels: ['bug'] })],
      closedIssues: [],
    });
    expect(result.markdown).not.toContain('### Other Changes');
  });

  it('always includes all 5 PRD-required section headers', () => {
    const result = service.generate({
      owner: 'o',
      repo: 'r',
      sinceISODate: '2026-01-01',
      mergedPullRequests: [],
      closedIssues: [],
    });
    for (const heading of [
      'Breaking Changes',
      'Features',
      'Bug Fixes',
      'Improvements',
      'Documentation',
    ]) {
      expect(result.markdown).toContain(`### ${heading}`);
    }
  });
});
