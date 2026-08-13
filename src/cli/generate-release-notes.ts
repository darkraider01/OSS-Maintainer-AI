import { writeFileSync } from 'node:fs';
import { logger } from '../config/logger.js';
import { createGitHubAppClient } from '../gateway/github/client.js';
import { ReleaseNotesService } from '../core/release-notes/release-notes-service.js';

interface CliArgs {
  owner: string;
  repo: string;
  sinceISODate: string;
  outFile?: string;
}

function defaultSince(): string {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return thirtyDaysAgo.toISOString().slice(0, 10);
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const repoArg = args.find((a) => a.includes('/') && !a.startsWith('--'));
  if (!repoArg) {
    logger.error('Usage: pnpm run release-notes <owner>/<repo> [--since=YYYY-MM-DD] [--out=FILE]');
    process.exit(1);
  }
  const [owner, repo] = repoArg.split('/');

  const sinceArg = args.find((a) => a.startsWith('--since='));
  const outArg = args.find((a) => a.startsWith('--out='));

  return {
    owner,
    repo,
    sinceISODate: sinceArg ? sinceArg.slice('--since='.length) : defaultSince(),
    outFile: outArg ? outArg.slice('--out='.length) : undefined,
  };
}

/**
 * Generates release notes from actual merged PRs and closed issues since a
 * date (FR: issue #23, nice-to-have). Every generated line references its
 * source PR/issue — nothing here is invented.
 */
export async function generateReleaseNotesCli(): Promise<void> {
  const { owner, repo, sinceISODate, outFile } = parseArgs();
  const githubClient = createGitHubAppClient();
  const service = new ReleaseNotesService();

  logger.info({ owner, repo, sinceISODate }, 'Fetching merged PRs and closed issues');
  const [mergedPullRequests, closedIssues] = await Promise.all([
    githubClient.listMergedPullRequests(owner, repo, sinceISODate),
    githubClient.listClosedIssues(owner, repo, sinceISODate),
  ]);

  const { markdown } = service.generate({
    owner,
    repo,
    sinceISODate,
    mergedPullRequests,
    closedIssues,
  });

  if (outFile) {
    writeFileSync(outFile, markdown, 'utf-8');
    logger.info({ outFile }, 'Release notes written to file');
  } else {
    // eslint-disable-next-line no-console
    console.log(markdown);
  }
}

if (process.env.NODE_ENV !== 'test') {
  generateReleaseNotesCli().catch((error) => {
    logger.error({ err: error }, 'Release notes generation failed');
    process.exit(1);
  });
}
