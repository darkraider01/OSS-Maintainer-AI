# Remaining Work — Implementation Audit (Phase 0)

Audit date: 2026-08-13. Scope: current `main` @ `63fd69f`. This document is the
output of the Phase 0 repository audit requested ahead of the maintainer-workflow
roadmap (Issue Triage, Onboarding, Escalation, reliability, security,
observability, PR summaries, load testing, and the nice-to-have analytics
features). No code was changed to produce this document.

## 1. Correction to the roadmap's premise

The roadmap that kicked off this work assumes the open-issue set starts at
**#18 (Issue Triage)**. That is not what the repository's issue tracker
contains. The actual open issues are:

| #   | Title                                             | Labels                   | State                                    |
| --- | ------------------------------------------------- | ------------------------ | ---------------------------------------- |
| 10  | Implement semantic retrieval for documentation QA | critical, knowledge      | **open, not integrated**                 |
| 11  | Add incremental re-indexing                       | knowledge                | open                                     |
| 12  | Build GitHub API client for repo metadata         | github-service           | **open, partially done**                 |
| 13  | Implement duplicate issue detection               | critical, github-service | open                                     |
| 14  | Implement intent classification                   | orchestrator             | **open, not started**                    |
| 15  | Build Tool Router                                 | orchestrator             | **open, not started**                    |
| 16  | Integrate LLM provider with tool calling          | critical, llm            | **open, not started** (tool calling)     |
| 17  | Build Response Builder                            | response-builder         | open, minimal version exists             |
| 18  | Implement Issue Triage flow                       | critical, workflow       | open                                     |
| 19  | Implement Contributor Onboarding flow             | workflow                 | open                                     |
| 20  | Implement Human Escalation detection              | critical, workflow       | open                                     |
| 21  | PR Summaries                                      | workflow, nice-to-have   | open                                     |
| 22  | Contributor Profiles                              | nice-to-have             | open                                     |
| 23  | Release Notes generation                          | nice-to-have             | open                                     |
| 24  | Issue Analytics                                   | nice-to-have             | open                                     |
| 25  | Structured logging, metrics, tracing              | observability            | open                                     |
| 26  | Authentication and rate limiting                  | security                 | open                                     |
| 27  | Graceful degradation and retry handling           | reliability              | open                                     |
| 28  | Load/scale testing                                | testing, performance     | open                                     |
| 39  | test issue                                        | —                        | ignore (test artifact, per instructions) |

**#10–#17 are still open, and they are load-bearing.** #18/#19/#20 as
specified (multi-turn state, structured field extraction, intent-based
routing to different workflows, tool calling) cannot be built directly on top
of the current `MaintainerAgent` — that class is a single unconditional LLM
call with no intent classification, no tool router, and no workflow state.
Closed issues #1–#9 (repo scaffolding, data models, Caspian/GitHub/Slack/Discord
adapters, communication normalization, conversation memory, contributor
history, doc ingestion) are genuinely done and match what's in `src/`.

This changes the critical path. See §5.

## 2. What's actually implemented (verified by reading source, not issue titles)

**Solid / production-plausible:**

- Communication normalization: `UnifiedEvent`, `CommunicationService`,
  `ConversationService`, `IdentityService`, `DeduplicationService`,
  `MessagePersistenceService`, `EventBus` (`src/gateway/adapters/*`,
  `src/gateway/event-bus.ts`) — well factored, has dedicated tests
  (`tests/gateway/communication-subsystem.test.ts`,
  `tests/gateway/identity-link.test.ts`, `tests/gateway/event-bus.test.ts`).
- GitHub direct channel (bypasses Caspian, per ADR/design intent):
  `src/gateway/github-gateway.ts`, `src/gateway/github/{client,egress,
webhook-signature,bot-identity}.ts`. Has webhook signature validation,
  self-event prevention (bot-identity), mention gating. Covered by
  `tests/gateway/github-*.test.ts` (7 files).
- Slack/Discord via Caspian: `src/gateway/adapters/{slack,discord}.ts`,
  `src/gateway/caspian-gateway.ts`, `src/gateway/caspian/*`.
- Cross-channel identity linking + OAuth: `src/web/oauth/*`,
  `src/web/auth-routes.ts`, `src/web/link-session-store.ts`. Tested
  (`tests/web/*.test.ts`).
- Documentation ingestion pipeline (issue #9, closed): chunking, embeddings,
  idempotent via checksum (`src/core/knowledge/ingestion-service.ts`,
  `chunker.ts`). Uses `MockLLMProvider`/`LiveLLMProvider.embed()`.
- Contributor history service (issue #8, closed):
  `src/core/knowledge/contributor-history-service.ts`.
- Persistence: Drizzle schema for actors, accounts, conversations, messages,
  repositories, executions, execution_events, tool_calls, memories,
  memory_chunks, knowledge_sources, documents, document_chunks, embeddings
  (pgvector). SQLite (dev/test) and Postgres (prod) migrations both present
  (`src/db/migrations*`). 117/117 tests pass as of this audit.
- `LLMProvider` abstraction (`src/core/llm/llm-provider.ts`) with
  `MockLLMProvider` and `LiveLLMProvider` (Gemini). Clean provider boundary —
  workflows should depend on this interface, not on Gemini directly.

**Thin / stub / missing:**

- `MaintainerAgent` (`src/core/agent/maintainer-agent.ts`): 31 lines. Takes
  the prebuilt prompt, calls `llm.generate()`, returns text with a
  hardcoded `confidence: 0.95`. No intent classification, no workflow
  routing, no tool execution (`AgentContext.tools` is always `[]`,
  `AgentResponse.actions` is always `[]`).
- `WorkflowEngine` (`src/core/workflow/workflow-engine.ts`): assembles
  prompt context and memory (this part is solid) but always dispatches to
  a single agent (`event.metadata?.agent || 'maintainer-agent'`) — there is
  no router that picks Triage vs. Onboarding vs. Escalation vs. general QA.
- `OutputAdapters` (`src/core/workflow/output-adapters.ts`): 37 lines,
  GitHub/Slack text formatting only. No Discord adapter registered (falls
  through to raw text — verify before Phase 8 doc claims otherwise). No
  citation formatting (issue #17 explicitly asks for this).
- No RAG retrieval call site: `ingestion-service.ts` writes embeddings, but
  nothing in `WorkflowEngine`/`MaintainerAgent` queries `document_chunks`/
  `embeddings` at response time. Issue #10 (semantic retrieval for doc QA) is
  genuinely unbuilt, not just unlabeled.
- No duplicate-issue detection (#13) — no similarity search over past issues.
- `LiveLLMProvider.generate()` doesn't accept/pass `history` to the actual
  Gemini call (parameter is accepted but only `systemPrompt`/`userPrompt` are
  sent — `src/core/llm/llm-provider.ts:109-161`) and has no tool-calling
  support despite `supportsTools() → true`.
- No retry/backoff, no circuit breaker anywhere in the codebase (grepped —
  none found). Issue #27 is fully open.
- No metrics emission (no counters/histograms; only `pino` structured logs
  via `src/config/logger.ts`, which is fine as a logging foundation but
  isn't metrics). Issue #25 is partially started (structured logging with
  `correlationId`/`eventId` already flows through `EventEnvelope` and
  `WorkflowEngine`'s child logger) but metrics/tracing are not started.
- No rate limiting anywhere. Webhook signature validation exists for GitHub
  and Caspian (`webhook-signature.ts` in both), but there's no per-IP/
  per-actor/per-conversation limiter, and no auth on any non-webhook API
  route beyond the OAuth linking flow. Issue #26 is open as described.
- No escalation model, no `EscalationReason`/`EscalationState`/
  `EscalationDecision` types anywhere.
- No PR summary workflow, no contributor profile aggregation view, no
  release-notes generator, no issue-analytics rollups (#21–#24, all
  nice-to-have, all genuinely unbuilt).
- No load-testing harness (#28).

**Dead/placeholder code found (candidates for removal, not urgent):**

- `src/core/index.ts`, `src/shared/index.ts`, `src/types/index.ts` — each is
  a one-line "placeholder" comment, no exports used anywhere (verified via
  grep — nothing imports from `core/index.ts`, `shared/index.ts`, or
  `types/index.ts` outside themselves).
- `src/core/handlers/echo-handler.ts` — comment says "placeholder the
  orchestrator replaces once agent routing lands"; agent routing (the
  `WorkflowEngine`) already exists and doesn't reference this handler. Check
  before deleting — it may still be registered somewhere for demo mode.

## 3. Architecture-doc drift (risk)

`docs/architecture/sequence-issue-triage.md` currently documents a
**different triage flow than the PRD requires**: it shows the orchestrator
auto-applying labels, auto-assigning owners, and auto-posting a comment in
one pass, with no missing-field follow-up loop and no confirmation gate. The
new PRD explicitly requires multi-turn field collection and says "prefer
confirmation before external side effects" and "do not create an issue
automatically unless explicitly allowed." **This doc must be rewritten
alongside the Phase 2 implementation**, not left as stale/contradictory
architecture documentation (this is exactly the kind of drift ADR-0005 says
the C4 docs should prevent).

## 4. Database tables needed for upcoming features

Already present and reusable as-is:

- `executions` / `execution_events` / `tool_calls` / `execution_artifacts` —
  can carry Triage/Escalation/Onboarding workflow state and tool-call
  records without new tables, if repurposed. **Read these schemas closely
  before adding new tables** — e.g., `IssueTriageState` (multi-turn missing-
  field tracking) may fit inside `executions.state` + `execution_events`
  rather than needing a bespoke `issue_triage_sessions` table.
- `memories` / `memory_chunks` — usable for escalation context preservation.
- `document_chunks` / `embeddings` — usable for onboarding doc retrieval
  (CONTRIBUTING.md, README, setup docs) once ingested per-repo via the
  existing ingestion pipeline.

Likely genuinely new (to confirm during Phase 2/4 design, not assumed here):

- A place to persist `EscalationDecision`/`EscalationState` if it needs to
  outlive a single execution (e.g., "conversation is under human control" is
  a conversation-level flag, not an execution-level one — may need a column
  on `conversations`, not a new table).
- Nothing else appears structurally missing; the schema was clearly designed
  ahead of time for agent/workflow/execution tracking (`docs/architecture/
persistence.md`).

## 5. Recommended implementation order (revised)

The PRD's Phase 1→2 jump (GitHub verification straight to Issue Triage)
skips prerequisites that don't exist yet. Revised order:

```
Phase 0   Repository audit                         [this document]
Phase 1   GitHub integration verification           (small; mostly done)
Phase 1.5 Workflow Router + Intent Classification    (#14) — REQUIRED before
          #18/#19/#20 can share one MaintainerAgent per the "no
          IssueTriageAgent/OnboardingAgent" architecture rule (PRD §18)
Phase 1.6 Tool calling on LLMProvider (#16, subset)  — needed for triage
          field-extraction and onboarding doc retrieval to be structured
          rather than prompt-only
Phase 2   Issue Triage (#18)                        — depends on 1.5, 1.6
Phase 3   Contributor Onboarding (#19)               — depends on 1.5,
          semantic retrieval (#10, subset: query-time only, ingestion
          already exists)
Phase 4   Human Escalation (#20)                     — depends on 1.5
Phase 5   Reliability (#27)
Phase 6   Security / auth / rate limiting (#26)
Phase 7   Observability (#25)                        — logging foundation
          exists; add metrics + tracing spans
Phase 8   PR Summaries (#21, nice-to-have)
Phase 9   Load/scale testing (#28)
Phase 10  Contributor Profiles / Release Notes / Issue Analytics (#22-24)
```

**Phase 1.5/1.6 are the load-bearing addition.** They are scoped narrowly —
just enough Workflow Router + tool-calling plumbing for Triage/Onboarding/
Escalation to be three routes through one `MaintainerAgent`, not three
agents (per PRD §18's explicit prohibition on `IssueTriageAgent` /
`OnboardingAgent` / `EscalationAgent` classes). Full scope of #13 (duplicate
issue detection), #11 (incremental re-indexing), #15 (generalized tool
router for arbitrary tools), and full #16 (all tool types) is **not**
required to unblock #18/#19/#20 and is deferred to stay in line with "don't
implement nice-to-have or unrelated scope before critical workflows."

## 6. Known architectural risks

1. **Confidence is fake.** `MaintainerAgent` hardcodes `confidence: 0.95` on
   every response (`maintainer-agent.ts:21`). Issue #20's escalation trigger
   "low confidence" cannot work until confidence is computed from something
   real (e.g., LLM-reported uncertainty, intent-classification score, or
   presence of grounding context). This needs a design decision before
   Phase 4, not just a wiring change.
2. **`LiveLLMProvider` silently drops conversation history** on live Gemini
   calls (only system+user prompt strings are sent; `history` param is
   accepted but unused in the live path). Multi-turn Triage depends on the
   agent seeing prior turns — currently that only works because
   `WorkflowEngine` re-injects history into the _text_ of `userPrompt` via
   `PromptBuilder`, not via the `history` argument. Worth confirming this
   text-embedded-history approach is sufficient for Triage state tracking,
   or whether structured turn state is needed instead (see `IssueTriageState`
   requirement in the PRD — likely needs to live in `executions`/
   `execution_events`, independent of prompt text).
3. **No workflow router exists**, so today "intent" is decided by
   `event.metadata?.agent`, which nothing currently sets to anything other
   than the default. Building the router is the actual Phase 2 prerequisite,
   not a side detail.
4. **`OutputAdapters` has no Discord formatter** — falls through to raw
   `response.text`. Should confirm this is intended before claiming full
   three-provider parity in Phase 8 documentation.
5. **Architecture-doc drift** — see §3. `sequence-issue-triage.md` describes
   an auto-label/auto-assign flow that contradicts the new PRD's
   confirm-before-side-effects requirement.
6. **No auth/rate limiting on any HTTP surface** beyond webhook signature
   checks — the account-linking OAuth routes and any future API surface are
   unauthenticated. Flagged for Phase 6, not fixed here.

## 7. Test coverage already covering upcoming requirements

- `tests/core/agent-workflow-e2e.test.ts` — existing E2E harness for event →
  agent → response; **extend this rather than building a parallel E2E
  suite** for Triage/Onboarding/Escalation.
- `tests/gateway/communication-subsystem.test.ts` — proves Slack/Discord/
  GitHub all converge on the same `UnifiedEvent` → pipeline today; this is
  the regression baseline PRD §22 asks to protect.
- No existing tests reference intent classification, triage state, onboarding
  content retrieval, or escalation — confirmed via grep, all net-new.

## 8. What Phase 0 did _not_ do

No source files were modified. `.env`, secrets, and DB state were not
touched. Test suite was run read-only (`pnpm test`) to confirm baseline
(117/117 passing) before any implementation work begins.
