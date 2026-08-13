import type { Intent, IntentClassificationResult, IntentClassifier } from './intent-types.js';

/**
 * Documented sensitive-topic / explicit-human-request policy (PRD §9: "do not
 * create an arbitrary sensitive-topic classifier without documenting the
 * policy"). Any match here always wins — sensitive topics are a hard
 * override, independent of confidence, and are handled before bug/onboarding
 * matching runs.
 */
const ESCALATION_KEYWORDS: readonly string[] = [
  // Security incidents
  'security vulnerability',
  'security incident',
  'data breach',
  'zero-day',
  'zero day',
  'cve-',
  // Credentials / secrets exposure
  'leaked credential',
  'leaked api key',
  'leaked secret',
  'exposed password',
  'exposed token',
  'private key leaked',
  'my password',
  // Harmful actions / safety
  'kill myself',
  'self harm',
  'self-harm',
  'suicide',
  'threat to',
  // Moderation conflicts
  'code of conduct violation',
  'report a user',
  'this is harassment',
  'harassment',
  'abusive behavior',
  // Legal / compliance
  'lawsuit',
  'legal action',
  'cease and desist',
  'gdpr request',
  'subpoena',
  'compliance violation',
  // Explicit request for a human
  'talk to a human',
  'speak to a maintainer',
  'speak to a human',
  'talk to a maintainer',
  'need a maintainer',
  'real person',
  'escalate this',
  'escalate to a human',
];

const BUG_REPORT_KEYWORDS: readonly string[] = [
  'bug',
  'crash',
  'crashes',
  'crashed',
  'crashing',
  'error',
  'exception',
  'traceback',
  'stack trace',
  "doesn't work",
  'does not work',
  'broken',
  'fails',
  'failing',
  'failed to',
  'not working',
  'unexpected behavior',
  'reproduce',
];

const CONTRIBUTION_KEYWORDS: readonly string[] = [
  'how do i contribute',
  'how can i contribute',
  'start contributing',
  'contributing guide',
  'good first issue',
  'getting started',
  'where do i start',
  'first time contributing',
  'want to contribute',
  'how to contribute',
  'pick up an issue',
  'new contributor',
];

const PR_SUMMARY_KEYWORDS: readonly string[] = [
  'summarize this pr',
  'summarize this pull request',
  'summarise this pr',
  'pr summary',
  'pull request summary',
  'summarize the changes',
  'what does this pr do',
  'what does this pull request do',
];

function matchKeywords(text: string, keywords: readonly string[]): string[] {
  return keywords.filter((keyword) => text.includes(keyword));
}

/**
 * Rule-based intent classifier. Deterministic and network-free, so it works
 * identically under MockLLMProvider and LiveLLMProvider and stays reliably
 * testable. An LLM-backed implementation can be swapped in later behind the
 * same `IntentClassifier` interface — deferred because it needs structured
 * (not free-text) LLM output, which is broader scope than unblocking
 * Triage/Onboarding/Escalation required (see docs/implementation/remaining-work.md §5).
 */
export class RuleBasedIntentClassifier implements IntentClassifier {
  async classify(text: string | null): Promise<IntentClassificationResult> {
    const normalized = (text ?? '').toLowerCase();

    const escalationMatches = matchKeywords(normalized, ESCALATION_KEYWORDS);
    if (escalationMatches.length > 0) {
      return {
        intent: 'escalation_signal',
        confidence: Math.min(0.95, 0.7 + 0.1 * escalationMatches.length),
        signals: escalationMatches,
      };
    }

    const prSummaryMatches = matchKeywords(normalized, PR_SUMMARY_KEYWORDS);
    if (prSummaryMatches.length > 0) {
      return {
        intent: 'pr_summary_request',
        confidence: Math.min(0.95, 0.65 + 0.12 * prSummaryMatches.length),
        signals: prSummaryMatches,
      };
    }

    const bugMatches = matchKeywords(normalized, BUG_REPORT_KEYWORDS);
    const contributionMatches = matchKeywords(normalized, CONTRIBUTION_KEYWORDS);

    if (bugMatches.length > 0 && contributionMatches.length > 0) {
      // Genuinely ambiguous — message reads as both a bug report and a
      // contribution question. Low confidence is the honest answer here,
      // and it's the intended trigger for EscalationService's
      // low-confidence path, not a fallback default.
      const intent: Intent =
        bugMatches.length >= contributionMatches.length ? 'bug_report' : 'contribution_question';
      return {
        intent,
        confidence: 0.4,
        signals: [...bugMatches, ...contributionMatches],
      };
    }

    if (bugMatches.length > 0) {
      return {
        intent: 'bug_report',
        confidence: Math.min(0.95, 0.6 + 0.12 * bugMatches.length),
        signals: bugMatches,
      };
    }

    if (contributionMatches.length > 0) {
      return {
        intent: 'contribution_question',
        confidence: Math.min(0.95, 0.6 + 0.12 * contributionMatches.length),
        signals: contributionMatches,
      };
    }

    // No special-handling signals — a plain question deserves a plain,
    // confident answer, not a default "we're not sure" score.
    return { intent: 'general_qa', confidence: 0.85, signals: [] };
  }
}
