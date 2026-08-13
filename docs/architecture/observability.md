# Observability

Covers issue #25 (structured logging, metrics, tracing). Deliberately
lightweight — no OpenTelemetry Collector, no Prometheus server, no Grafana
dependency added to run this app (contrast with the aspirational topology in
[deployment.md](deployment.md), which predates this implementation).

## Structured logging

`pino` (`src/config/logger.ts`), pretty-printed outside production. Every
`WorkflowEngine` child logger carries `eventId`/`correlationId` from the
`EventEnvelope`, so log lines for one event's processing can be filtered
together. One line per agent execution carries the full field set:

```
correlationId, causationId, eventId, provider, conversationId, actorId,
executionId, workflow, durationMs, status
```

— logged as `'Agent execution completed'` in `WorkflowEngine.handleEvent`.
That's the trace: `correlationId` ties an ingress event to everything it
caused, reusing IDs that already flow through the pipeline rather than
introducing a second tracing system with its own ID scheme.

## Metrics

`src/core/observability/metrics.ts` — hand-rolled `Counter`/`Histogram`
primitives, no dependency, rendering standard Prometheus text exposition at
`GET /metrics`. Names match the PRD's list exactly:

`events_received_total`, `events_processed_total`, `events_failed_total`,
`llm_requests_total`, `llm_request_duration_seconds`, `llm_failures_total`,
`provider_requests_total`, `provider_failures_total`,
`agent_executions_total` (labeled by which workflow ran),
`agent_execution_duration_seconds`, `escalations_total` (labeled by
reason), `deduplicated_events_total`.

A real Prometheus server can scrape `/metrics` directly — the exposition
format is standard, this app just doesn't run one itself.

## Tracing

No distributed tracing backend (Jaeger, Tempo, etc.) is wired up. What
exists instead: the `correlationId`/`causationId`/`eventId` triple already
threading through every log line above reconstructs the same
ingress→normalize→agent→LLM→tool→response path a trace would show, filtered
by one ID in whatever log aggregator you point at this app's stdout. If a
real tracing backend gets added later, these are the IDs it should reuse —
see the PRD's own instruction not to build two tracing systems.

## Issue Analytics (#24) — a different kind of number

`/metrics` above is live, in-process, resets on restart. Issue Analytics
(`src/core/analytics/issue-analytics-service.ts`, `GET /analytics`) answers
a different question — historical numbers derived from the database, not
counters since process start: conversation volume, escalation rate and
reason breakdown, open-triage count, average time-to-first-response, over
any `?since=` window. It deliberately does _not_ duplicate
`deduplicated_events_total` (that's genuinely in-memory-only, nothing to
query from the DB) or claim a "resolution time" metric (nothing in the
schema marks a conversation resolved — see the doc comment at the top of
`issue-analytics-service.ts` for the full reasoning).
