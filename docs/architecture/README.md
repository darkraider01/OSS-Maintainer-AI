# OSS-Maintainer-AI Technical Architecture

Welcome to the **OSS-Maintainer-AI** architectural specification. This documentation describes the design, execution life cycles, models, and platform integrations of the co-maintainer system.

---

## Documentation Contents

### 1. C4 Architecture Models

- [C4 Level 1: System Context Diagram](c4-context.md) — High-level boundaries detailing users, external integrations, the Caspian SDK runtime, and LLM providers.
- [C4 Level 2: Container Diagram](c4-container.md) — The decoupled services, message bus, configuration handlers, and database boundaries.
- [C4 Level 3: Component Diagram](c4-component.md) — Deep-dive analysis of runtime execution engines, prompt compilers, context builders, and tool routing cycles.

### 2. Lifecycles & Sequence Traces

- [Sequence Trace: Agent Execution](sequence-agent-execution.md) — Step-by-step workflow loop documenting tool queries, LLM updates, and observations.
- [Sequence Trace: Issue Triage](sequence-issue-triage.md) — Triage analysis loop showcasing labeling decision workflows.

### 3. Service Sub-Systems

- [Runtime Engine](runtime.md) — Core event lifecycles, states, and execution loops. _(Original design; see the accuracy note at the top — [workflows.md](workflows.md) describes what's actually implemented.)_
- [Persistence Layer](persistence.md) — Relational datastore schema, migrations, SQLite fallbacks, and pgvector embeddings.
- [Platform Integrations](integrations.md) — How the Integration Adapter Layer keeps repository logic channel-independent.
- [Deployment Topology](deployment.md) — Infrastructure diagram. _(Original target topology; see the accuracy note at the top.)_

### 4. Maintainer Workflows & Platform Concerns (current implementation)

- [Maintainer Workflows](workflows.md) — Issue Triage, Onboarding, Escalation, PR Summaries: routing, and what each actually does.
- [Reliability](reliability.md) — Retry/circuit-breaker + the durable delivery-retry queue.
- [Security](security.md) — Authentication posture, rate limiting, secret hygiene.
- [Observability](observability.md) — Structured logging, metrics, tracing, Issue Analytics.
- [Configuration Reference](../configuration.md) — Every env var, grouped by feature.
- [Load & Scale Test Report](../performance/load-test-report.md) — Measured throughput/latency, clearly separated from targets and limitations.
