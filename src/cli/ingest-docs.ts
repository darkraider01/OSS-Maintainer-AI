import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { createGitHubAppClient } from '../gateway/github/client.js';
import { MockLLMProvider, LiveLLMProvider } from '../core/llm/llm-provider.js';
import type { LLMProvider } from '../core/llm/llm-provider.js';
import { ingestRepositoryDocs } from '../core/knowledge/ingestion-service.js';

function parseRepoArg(): { owner: string; repo: string } {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const arg = args[0];
  if (!arg || !arg.includes('/')) {
    logger.error('Usage: pnpm run ingest:docs <owner>/<repo>');
    process.exit(1);
  }
  const [owner, repo] = arg.split('/');
  return { owner, repo };
}

function resolveLlmProvider(): LLMProvider {
  if (env.DEMO_MODE || !env.LLM_API_KEY) return new MockLLMProvider();
  return new LiveLLMProvider(env.LLM_API_KEY, env.LLM_PROVIDER);
}

/**
 * Pulls a repo's README + `/docs`, chunks, embeds, and stores them (FR: issue #9).
 * Idempotent — safe to re-run; unchanged documents are skipped.
 */
export async function ingestDocsCli(): Promise<void> {
  const { owner, repo } = parseRepoArg();
  const githubClient = createGitHubAppClient();
  const llmProvider = resolveLlmProvider();

  logger.info({ owner, repo, llmProvider: llmProvider.name }, 'Starting documentation ingestion');
  logger.info(
    'Note: public repos generally work with the App\'s existing permissions; private repos may need "Contents: Read" added explicitly if this fails with a 403.'
  );

  const result = await ingestRepositoryDocs(owner, repo, githubClient, llmProvider);
  logger.info(result, 'Documentation ingestion complete');
}

if (process.env.NODE_ENV !== 'test') {
  ingestDocsCli().catch((error) => {
    logger.error({ err: error }, 'Documentation ingestion failed');
    process.exit(1);
  });
}
