# Reliability

Covers issue #27 (graceful degradation and retry handling). Two layers:
in-process retry/circuit-breaking for transient failures, and a durable
queue for failures that survive those retries.

## In-process: retry + circuit breaker

`src/core/resilience/` — provider-independent, reused by every external
dependency (not one retry implementation per provider):

- **`retry-policy.ts`** — bounded exponential backoff (default: 3 attempts,
  200ms base delay). Retries transient failures only: network errors, HTTP
  429, and 5xx. Never retries 4xx auth/validation failures — those won't
  succeed on a second try, so retrying them just burns time and quota.
- **`circuit-breaker.ts`** — CLOSED → (failures reach threshold) → OPEN →
  (cooldown elapses) → HALF_OPEN → success closes it again, failure reopens
  it. In-process state only, no distributed coordination.
- **`resilient-executor.ts`** — combines both; one instance per external
  dependency (`llm-gemini`, `github-api`, `caspian-egress`).

Wired into:

| Dependency                | File                                              | Behavior on exhaustion                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LLM (`generate`)          | `src/core/llm/llm-provider.ts`                    | Degrades to a user-facing "having trouble reaching the AI service" message — never throws into the agent.                                                                                        |
| LLM (`embed`)             | same                                              | Still throws — ingestion callers (`pnpm run ingest:docs`) need to know a run failed.                                                                                                             |
| LLM (`generateWithTools`) | same                                              | Same degrade-to-message behavior as `generate`.                                                                                                                                                  |
| GitHub API (all calls)    | `src/gateway/github/client.ts` (`trackedExecute`) | Read paths (docs, good-first-issues) degrade to empty results; `postIssueComment` still throws — a lost reply needs to be visible to the caller, which is what triggers the durable queue below. |
| Caspian egress            | `src/index.ts`                                    | Same — throws to the caller, triggering the durable queue.                                                                                                                                       |

`WorkflowEngine.handleEvent` also wraps the whole `agent.execute()` call in a
catch-all: any _other_ unexpected failure (a DB error, a bug in a workflow)
still produces a fallback reply instead of the event silently vanishing.
This also counts as a failed turn toward the escalation "repeated failure"
trigger (see [workflows.md](workflows.md)).

## Durable: the retry queue

In-process retries handle transient blips within one request. They don't
survive the process restarting mid-retry, and they don't help if a
provider is down for minutes rather than seconds. `src/core/delivery/`:

- **`pending_deliveries`** table — when `postGitHubReply` or the Caspian
  `client.reply()` call throws _after_ its `ResilientExecutor` retries are
  exhausted, `src/index.ts`'s egress wiring persists a row here instead of
  letting the failure just get logged and the reply lost.
- **`DeliveryRecoveryWorker`** (`delivery-recovery-worker.ts`) — sweeps due
  rows on a timer (default 60s), retries each through the _same_ deliverer
  the live egress path uses, with its own bounded backoff (default 5
  attempts, capped at 30 minutes between tries). Permanently failed after
  that — no unbounded retry loop.

```
envelope.respond(text)
        │
        ▼
ResilientExecutor.execute() ──succeeds──▶ delivered
        │ exhausted
        ▼
PendingDeliveryStore.enqueue()
        │
        ▼ (periodic sweep)
DeliveryRecoveryWorker.runOnce()
        │
   ┌────┴────┐
   ▼         ▼
delivered   still failing → reschedule (backoff) → ... → permanently failed
```

Started in `bootstrap()` (`src/index.ts`) alongside the webhook server —
skipped in tests and demo mode, same as the HTTP server itself.

## What this doesn't cover

- No dead-letter alerting when a delivery is permanently marked failed —
  it's a DB row (`pending_deliveries.status = 'failed'`), not a page. A
  maintainer would need to query for it.
- No cross-process coordination — if you ran multiple instances of this
  app, each would run its own `DeliveryRecoveryWorker` sweeping the same
  table with no locking. Fine at today's scale (see
  [`docs/performance/load-test-report.md`](../performance/load-test-report.md)),
  a real concern before running more than one instance.
