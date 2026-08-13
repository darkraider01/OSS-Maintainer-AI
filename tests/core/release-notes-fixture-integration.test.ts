import { describe, expect, it } from 'vitest';
import { ReleaseNotesService } from '../../src/core/release-notes/release-notes-service.js';
import { fakeGitHubClient } from '../helpers/fixtures.js';

describe('Release notes generation wired to a GitHubClientLike (#23)', () => {
  it("builds notes from a client's merged PRs and closed issues", async () => {
    const client = fakeGitHubClient([], {
      mergedPullRequests: [
        { number: 5, title: 'feat: add webhooks', htmlUrl: 'https://x/5', labels: [] },
      ],
      closedIssues: [
        { number: 6, title: 'Docs typo', htmlUrl: 'https://x/6', labels: ['documentation'] },
      ],
    });

    const [mergedPullRequests, closedIssues] = await Promise.all([
      client.listMergedPullRequests('o', 'r', '2026-01-01'),
      client.listClosedIssues('o', 'r', '2026-01-01'),
    ]);

    const result = new ReleaseNotesService().generate({
      owner: 'o',
      repo: 'r',
      sinceISODate: '2026-01-01',
      mergedPullRequests,
      closedIssues,
    });

    expect(result.categorized.Features).toHaveLength(1);
    expect(result.categorized.Documentation).toHaveLength(1);
    expect(result.markdown).toContain('#5');
    expect(result.markdown).toContain('#6');
  });
});
