import type { ReleaseNoteItem } from '../../gateway/github/client.js';
import type {
  ReleaseNoteCategory,
  ReleaseNotesInput,
  ReleaseNotesResult,
} from './release-notes-types.js';

// PRD's 5 required buckets, in publish order — "Other Changes" is not one of
// them, but categorizing an item under a bucket it doesn't actually belong
// to (e.g. calling every uncategorized PR a "Bug Fix") is itself a form of
// the fabrication PRD §16 prohibits, so uncategorized items go here instead
// and the section is simply omitted when empty.
const CATEGORY_ORDER: ReleaseNoteCategory[] = [
  'Breaking Changes',
  'Features',
  'Bug Fixes',
  'Improvements',
  'Documentation',
  'Other Changes',
];

function categorize(item: ReleaseNoteItem): ReleaseNoteCategory {
  const labels = item.labels.map((l) => l.toLowerCase());
  const title = item.title.toLowerCase();
  const hasLabel = (pattern: RegExp) => labels.some((l) => pattern.test(l));
  const titlePrefix = (prefix: RegExp) => prefix.test(title);

  if (hasLabel(/breaking/) || titlePrefix(/^\w+(\(.+\))?!:/) || title.includes('breaking change')) {
    return 'Breaking Changes';
  }
  if (hasLabel(/^bug$|\bfix\b/) || titlePrefix(/^fix(\(.+\))?:/)) {
    return 'Bug Fixes';
  }
  if (hasLabel(/feature|enhancement/) || titlePrefix(/^feat(\(.+\))?:/)) {
    return 'Features';
  }
  if (hasLabel(/documentation|\bdocs\b/) || titlePrefix(/^docs(\(.+\))?:/)) {
    return 'Documentation';
  }
  if (
    hasLabel(/refactor|chore|perf|improvement/) ||
    titlePrefix(/^(refactor|chore|perf)(\(.+\))?:/)
  ) {
    return 'Improvements';
  }
  return 'Other Changes';
}

function emptyCategoryMap(): Record<ReleaseNoteCategory, ReleaseNoteItem[]> {
  return {
    'Breaking Changes': [],
    Features: [],
    'Bug Fixes': [],
    Improvements: [],
    Documentation: [],
    'Other Changes': [],
  };
}

/**
 * Release Notes generation (#23, nice-to-have). Every item comes from an
 * actual merged PR or closed issue passed in — categorization is a
 * heuristic over GitHub labels and conventional-commit-style title prefixes,
 * never invented content (PRD §16: "do not hallucinate changes").
 */
export class ReleaseNotesService {
  generate(input: ReleaseNotesInput): ReleaseNotesResult {
    const categorized = emptyCategoryMap();
    for (const pr of input.mergedPullRequests) categorized[categorize(pr)].push(pr);
    for (const issue of input.closedIssues) categorized[categorize(issue)].push(issue);

    const sections = CATEGORY_ORDER.filter(
      (category) => category !== 'Other Changes' || categorized[category].length > 0
    ).map((category) => {
      const items = categorized[category];
      const lines =
        items.length > 0
          ? items.map((item) => `- [${item.title}](${item.htmlUrl}) (#${item.number})`)
          : ['- None'];
      return [`### ${category}`, ...lines].join('\n');
    });

    const markdown =
      [
        `## Release Notes: ${input.owner}/${input.repo}`,
        `_Changes since ${input.sinceISODate}_`,
        '',
        sections.join('\n\n'),
      ].join('\n') + '\n';

    return { categorized, markdown };
  }
}
