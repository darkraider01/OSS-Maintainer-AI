# Load & Scale Test Report (Issue #28)

**Status: measured, not extrapolated.** Every number below came from an actual
run of the harness in this repo (`src/cli/load-test.ts`) during this session,
on 2026-08-13. Nothing here is a target dressed up as a result — see §4 for
what's a target versus what's measured, and §5 for what this environment
cannot tell you.

## 1. What the harness does

`src/cli/load-test.ts` (via `pnpm run load-test`) drives the **real**
in-process pipeline — `CommunicationService` → `EventBus` → `WorkflowEngine`
→ `MaintainerAgent` → a workflow — against the same SQLite dev database and
`MockLLMProvider` this repo's tests use. It does not stub or shortcut the
pipeline; it calls `CommunicationService.ingest()` exactly like a real
webhook handler would, just without the HTTP layer in front of it (see §5.4
for why that's a real limitation, not a shortcut).

For each simulated conversation it builds a synthetic raw message (Slack or
GitHub-shaped, per `--channel`), times `ingest()` end-to-end (dedup → identity
→ conversation resolution → rate limiting → persistence → agent execution →
reply), and runs a configurable number of these concurrently via a simple
worker-pool. It reports throughput, latency percentiles, error/drop counts,
heap/RSS, and CPU time.

**Reproduce:**

```bash
pnpm run build
LOG_LEVEL=fatal node dist/cli/load-test.js --conversations=1000 --concurrency=50 --channel=slack
```

(`LOG_LEVEL=fatal` matters — pino's pretty-printer is expensive enough at
this volume to visibly skew the numbers; the harness also suppresses
`WorkflowEngine`'s demo-mode console trace for the same reason.)

## 2. Environment for every number in this report

- Single Windows machine, single Node process, no containers/orchestration.
- Compiled build (`node dist/cli/load-test.js`), not `ts-node` — avoids
  transpile-on-the-fly overhead contaminating the timings.
- Database: SQLite (`better-sqlite3`), the same dev/test database this repo
  always uses locally — **not** the pooled Postgres path this app uses in
  production (`src/db/client.ts` picks Postgres only when
  `DATABASE_URL`/`NODE_ENV=production` is set).
- LLM: `MockLLMProvider` — an in-process, network-free canned response.
  **No live LLM latency is reflected anywhere in this report.**
- No HTTP layer in the loop — see §5.4.

## 3. Measured results

### 3.1 Conversation scale (repos=1, concurrency=50, Slack, plain-question text)

Run cumulatively against the same growing SQLite file — 100, then +1,000,
then +10,000 more conversations (11,100 total by the end), which is a more
realistic "database grows over time" scenario than three fresh runs.

| Tier   | Total events | Success | Errors/Dropped | Wall time | Throughput | p50     | p95     | p99     |
| ------ | ------------ | ------- | -------------- | --------- | ---------- | ------- | ------- | ------- |
| 100    | 100          | 100     | 0 / 0          | 2.1 s     | 47.8/s     | 1032 ms | 1061 ms | 1061 ms |
| 1,000  | 1,000        | 1,000   | 0 / 0          | 23.4 s    | 42.7/s     | 1136 ms | 1460 ms | 1474 ms |
| 10,000 | 10,000       | 10,000  | 0 / 0          | 240.6 s   | 41.6/s     | 1185 ms | 1458 ms | 1870 ms |

**0 errors and 0 drops across all 11,100 cumulative conversations.**
Throughput held essentially flat (~42–48/s); p99 latency grew modestly
(1061 ms → 1870 ms) as the SQLite file and row counts grew — a real,
measured, mild degradation, not a cliff.

### 3.2 Repository scale (300 conversations each, concurrency=50, GitHub-shaped events, fresh DB per tier)

| Repos | Throughput | p50     | p95     | p99     |
| ----- | ---------- | ------- | ------- | ------- |
| 1     | 42.0/s     | 1144 ms | 1353 ms | 1354 ms |
| 10    | 41.7/s     | 1141 ms | 1659 ms | 1659 ms |
| 100   | 45.9/s     | 1015 ms | 1406 ms | 1407 ms |

**No measurable effect from repository count.** See §5.3 — this is expected
given the current architecture, not a surprising result to celebrate.

### 3.3 Concurrency sweep (300 conversations, repos=1, Slack)

| Concurrency | Wall time | Throughput | p50     | p95     | p99     |
| ----------- | --------- | ---------- | ------- | ------- | ------- |
| 10          | 7.1 s     | 42.5/s     | 233 ms  | 252 ms  | 282 ms  |
| 50          | 5.1 s     | 58.4/s     | 809 ms  | 998 ms  | 998 ms  |
| 100         | 4.9 s     | 61.6/s     | 1635 ms | 1643 ms | 1643 ms |
| 200         | 5.1 s     | 58.4/s     | 3440 ms | 3441 ms | 3441 ms |

**Throughput plateaus at ~42–62/s regardless of concurrency; latency gets
strictly worse past ~50–100.** This is the load test's single most important
finding — see §5.1.

### 3.4 Workflow-route comparison (200 conversations, concurrency=50, Slack)

| Route                              | Throughput | p50     | p95     | p99     |
| ---------------------------------- | ---------- | ------- | ------- | ------- |
| General QA (LLM call)              | 31.4/s     | 1513 ms | 1738 ms | 1738 ms |
| Issue Triage (regex only, no LLM)  | 38.1/s     | 1205 ms | 1518 ms | 1518 ms |
| Escalation (no LLM, shortest path) | 46.8/s     | 950 ms  | 1358 ms | 1358 ms |

Consistent with the code: Escalation and Triage skip the LLM round-trip
entirely (structural/regex logic per docs/implementation/remaining-work.md
§5), so they're measurably cheaper than General QA even against a
network-free mock LLM.

### 3.5 Resource usage (1,000-conversation run, concurrency=50, fresh DB)

- Heap: 97.7 MB → 72.2 MB (GC reclaimed between runs; no leak signature
  across the 10,000-conversation tier either — heap stayed in the 100–153 MB
  band).
- RSS: 324 MB for this run; grew to 1,030 MB over the cumulative
  11,100-conversation run in §3.1 (SQLite page cache growth, not a leak).
- CPU: 4.73 s user, **12.19 s system**, against 26.3 s wall time (~64%
  single-core utilization). System time dominating user time this heavily
  means the bottleneck is I/O (SQLite's synchronous writes/fsyncs), not
  computation — corroborates §3.3's concurrency-plateau finding.

## 4. Measured vs. target — do not conflate these

| Claim                                                                   | Status                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0% error rate up to 11,100 cumulative conversations, 10,000 in one tier | **Measured** (§3.1)                                                                                                                                                                                                                                                                       |
| Throughput plateaus ~42–62 events/s regardless of added concurrency     | **Measured** (§3.3)                                                                                                                                                                                                                                                                       |
| p50 latency ~1–1.5s at realistic concurrency (50) against a mock LLM    | **Measured** (§3.1–3.4)                                                                                                                                                                                                                                                                   |
| "<3s latency for common queries"                                        | **Target from the original NFRs — not validated against a live LLM here.** Mock-LLM p95/p99 stayed under 2s in every tier, which is _consistent with_ the target but doesn't prove it under real Gemini latency/variability.                                                              |
| "99% availability"                                                      | **Not measured. Do not cite this report as evidence for it.** The longest continuous run here was ~4 minutes; availability is a claim about behavior over days/weeks of real traffic, including deploys, provider outages, and restarts — none of which this harness exercises. See §5.5. |
| Behavior under 100 repositories                                         | **Measured as "no effect"** — but see §5.3 for why that's not the same as "scales to 100 repos in production."                                                                                                                                                                            |

## 5. Limitations — what this report cannot tell you

1. **The concurrency plateau is the real finding, and it's architectural.**
   `better-sqlite3` is synchronous — every DB call blocks Node's single
   thread while it runs. Node's event loop lets multiple in-flight requests
   _interleave_, but none of that pipeline's DB work runs in parallel;
   §3.5's system-time-dominated CPU profile confirms it's I/O-bound, not
   waiting on anything external. Concurrency beyond ~50 just queues requests
   longer (§3.3) without raising throughput. **Production Postgres with a
   real connection pool would behave differently — this report doesn't
   measure that, only this app's current SQLite dev path.**
2. **MockLLMProvider has zero network latency or failure modes.** None of
   this report reflects real Gemini API latency, rate limits, or the
   retry/circuit-breaker behavior built in Phase 5 — that logic is unit
   tested in isolation (`tests/core/retry-policy.test.ts`,
   `tests/core/circuit-breaker.test.ts`) but never exercised under this load
   harness. A live-LLM load test is a legitimate follow-up this report
   doesn't cover.
3. **Repository scale doesn't stress anything extra in the current
   architecture — which is itself a finding.** While auditing this,
   `ConversationService.resolveOrCreate` (`src/gateway/adapters/
conversation-service.ts`) always passes `repositoryId: null` — the
   general ingestion path never actually populates `conversations
.repositoryId`, and there's no per-repository caching or connection
   pooling to break down as repo count grows. §3.2's flat results are a
   direct consequence of that, not evidence the system would scale flat in
   an architecture that _did_ have per-repo state.
4. **No HTTP layer in this loop.** The harness calls `CommunicationService
.ingest()` directly, bypassing `webhook-server.ts` entirely — so none of
   these numbers include HTTP parsing, signature verification, or the
   Phase 6 rate limiter's overhead. That's a deliberate choice (isolates
   pipeline performance from network-stack noise) but means these numbers
   are a lower bound on real end-to-end webhook latency, not the full
   picture.
5. **No soak/availability test.** PRD explicitly warns not to claim 99%
   availability without measuring it over a meaningful period — this
   session's longest run was ~4 minutes. Nothing here validates behavior
   across restarts, deploys, provider outages, or multi-day uptime.
6. **Single process, single machine.** No horizontal scaling, load
   balancing, or multi-instance coordination is exercised — this app has no
   such mechanism today, so there's nothing to test yet.
