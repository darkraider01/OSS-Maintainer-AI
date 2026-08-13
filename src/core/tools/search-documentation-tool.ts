import type { Tool, AgentContext } from '../agent/agent-types.js';
import { searchDocumentation } from '../knowledge/semantic-search.js';

/**
 * The first (and, for now, only) real tool the general Q&A path can call —
 * closes #10 (semantic retrieval for documentation QA) by actually querying
 * the embeddings the ingestion pipeline (issue #9) already produces, instead
 * of leaving that data unused.
 */
export class SearchDocumentationTool implements Tool {
  readonly name = 'search_documentation';
  readonly description =
    "Searches this repository's ingested documentation (README, /docs, CONTRIBUTING.md) for content relevant to a query. Call this before answering questions about how the project works, how to set it up, or its conventions — don't guess if you haven't checked.";
  readonly parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for' },
    },
    required: ['query'],
  };

  async execute(args: Record<string, unknown>, context: AgentContext): Promise<unknown> {
    const query = typeof args.query === 'string' ? args.query : '';
    const repo = context.repositoryContext;
    if (!repo || !query) {
      return { results: [], note: 'No repository context available or empty query.' };
    }

    const results = await searchDocumentation(
      repo.owner,
      repo.repositoryName,
      query,
      context.llm,
      3
    );
    if (results.length === 0) {
      return {
        results: [],
        note: 'No ingested documentation found for this repository (has `pnpm run ingest:docs` been run for it?).',
      };
    }

    return {
      results: results.map((r) => ({
        path: r.path,
        excerpt: r.content.length > 500 ? `${r.content.slice(0, 500)}…` : r.content,
        relevance: Number(r.score.toFixed(3)),
      })),
    };
  }
}
