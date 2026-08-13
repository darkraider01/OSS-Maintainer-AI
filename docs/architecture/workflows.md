# Maintainer Workflows

Covers Issue Triage (#18), Contributor Onboarding (#19), Human Escalation
(#20), and PR Summaries (#21) — the four things `MaintainerAgent` can do
besides answer a plain question. This document describes what's actually
implemented; see the note at the top of [runtime.md](runtime.md) and
[c4-component.md](c4-component.md) for how this differs from those earlier,
more aspirational design docs.

## Routing: one agent, not four

Per the "no `IssueTriageAgent`/`OnboardingAgent`/`EscalationAgent`" rule, all
four workflows share one `MaintainerAgent` (`src/core/agent/maintainer-agent.ts`).
On every event it:

1. Classifies intent — `RuleBasedIntentClassifier`
   (`src/core/intent/intent-classifier.ts`), deterministic keyword matching,
   not an LLM call. `bug_report`, `contribution_question`,
   `escalation_signal`, `pr_summary_request`, or `general_qa`.
2. Structurally overrides that classification to `pr_summary_request` when
   the event is a freshly-opened PR (`metadata.github.kind === 'pull_request'
&& action === 'opened'`) — a real signal, not a text-classification guess.
3. Runs `EscalationService.evaluate()` — a cross-cutting check that can win
   over any of the above (see "Escalation" below).
4. Dispatches to the matching `Workflow` via `WorkflowRouter`
   (`src/core/workflow/workflow-router.ts`).

```
MaintainerAgent
      │
      ▼
IntentClassifier (+ structural PR-opened override)
      │
      ▼
EscalationService.evaluate() ── shouldEscalate? ──▶ EscalationWorkflow
      │ no
      ▼
WorkflowRouter
      │
 ┌────┼─────────┬──────────────┐
 ▼    ▼         ▼              ▼
Triage Onboard PRSummary   General (+ tools)
```

Workflows are pure functions over `AgentContext` — no direct DB access. All
persistence (escalation flag, failure streak, in-flight triage fields,
onboarding timestamp) happens in `WorkflowEngine`, driven by keys the
workflow returns on `AgentResponse.metadata` (`WorkflowMetadata` in
`src/core/workflow/workflow-types.ts`).

## Issue Triage (#18)

`TriageWorkflow` → `IssueTriageService` (`src/core/triage/issue-triage-service.ts`).

- Multi-turn: extracts reproduction steps, logs, SDK version, OS, and
  environment details from message text via regex/heuristic matching — not
  an LLM call, so it's deterministic and doesn't depend on prompt phrasing.
  State (`IssueTriageState`) persists on `conversations.triage_state` (jsonb)
  between turns, cleared once complete.
- **Never creates a GitHub issue.** Once all fields are collected it
  produces a summary and asks for confirmation — actual issue creation
  requires a maintainer's explicit action, per the "confirm before external
  side effects" policy. There is no code path that calls the GitHub issue-
  creation API.
- A message that reads as _both_ a bug report and a contribution question
  gets a deliberately low confidence score (ambiguous), which naturally
  feeds the escalation "low confidence" trigger below.

## Contributor Onboarding (#19)

`OnboardingWorkflow` (`src/core/workflow/workflows/onboarding-workflow.ts`).

- Fetches the repo's README, CONTRIBUTING.md, and `good first issue`-labeled
  open issues via the live GitHub client (`GitHubAppClient.getRepositoryDocs`
  / `listGoodFirstIssues`) — not the semantic-search embeddings pipeline
  (see "Why two doc-retrieval paths?" below).
- If no GitHub client is configured, or the repository has no docs, it says
  so explicitly rather than inventing setup instructions.
- On a successful run, `WorkflowEngine` sets `actors.onboarded_at` — the
  contributor-profile signal described in
  [../implementation/remaining-work.md](../implementation/remaining-work.md).

### Why two doc-retrieval paths?

Onboarding and General Q&A both answer questions from repository docs, but
through different mechanisms:

- **Onboarding** calls the GitHub API live, every time — it needs the
  _current_ README/CONTRIBUTING.md/issue list, and onboarding is infrequent
  enough that a live call is cheap.
- **General Q&A** calls `search_documentation`
  (`src/core/tools/search-documentation-tool.ts`), a real LLM tool-call
  (Gemini function-calling) that does in-app cosine-similarity search over
  the `document_chunks`/`embeddings` tables the ingestion pipeline
  (`pnpm run ingest:docs`) already populates — no live GitHub call per
  question. See [observability.md](observability.md)'s sibling doc,
  [reliability.md](reliability.md), for how that tool call degrades if the
  LLM or DB is unavailable.

These aren't redundant: Onboarding wants freshness (a new CONTRIBUTING.md
today), General Q&A wants low-latency retrieval over content that changes
rarely (README prose). Unifying them onto one path was considered and
rejected — see `docs/implementation/remaining-work.md` for the reasoning.

## Human Escalation (#20)

`EscalationService.evaluate()` (`src/core/escalation/escalation-service.ts`)
is a pure decision function, checked on every turn regardless of which
workflow would otherwise handle it. Three triggers, in priority order:

1. **Sensitive topic** (`escalation_signal` intent) — a documented keyword
   policy in `intent-classifier.ts` (security incidents, credential leaks,
   self-harm language, moderation/legal issues, explicit "talk to a human"
   requests). Always wins, regardless of confidence.
2. **Repeated failure** — `conversations.failure_streak` (incremented by
   `WorkflowEngine` whenever a turn's confidence is below threshold, reset
   on a confident turn) reaching 3.
3. **Low confidence** — the current turn's intent-classification confidence
   below 0.5.

When escalation fires, `DefaultEscalationWorkflow`
(`src/core/workflow/workflows/escalation-workflow.ts`):

- Sets `conversations.escalated_at` — `WorkflowEngine` checks this _before_
  even loading conversation history on every subsequent turn, so the agent
  never auto-replies to an escalated conversation again until a human clears
  it (there's no "un-escalate" API yet — that's a manual DB update today).
- @-mentions a configured maintainer in the reply itself, if one is
  configured for that provider (`MAINTAINER_GITHUB_USERNAME` /
  `MAINTAINER_SLACK_MENTION` / `MAINTAINER_DISCORD_MENTION`) — see
  [configuration.md](../configuration.md). This is a real, platform-native
  notification through the same egress path the reply already uses; there's
  no separate paging integration (PagerDuty, email) — see
  `docs/implementation/remaining-work.md` for why.

## PR Summaries (#21, nice-to-have)

`PRSummaryWorkflow` → `PRSummaryService` (`src/core/pr-summary/pr-summary-service.ts`).

Triggers automatically when a PR is opened, or on an explicit "summarize
this PR" request in a PR thread. Always retrieves the actual changed-file
list (`GitHubAppClient.listPullRequestFiles`) before writing anything —
objective, changes, related issues (parsed from "fixes #N" references), and
risks (migration/CI/dependency/auth-path heuristics) are all derived from
that diff, never fabricated. See [sequence-issue-triage.md](sequence-issue-triage.md)
for the equivalent trace on the Triage side; PR Summaries follows the same
"retrieve real data, then write" shape.
