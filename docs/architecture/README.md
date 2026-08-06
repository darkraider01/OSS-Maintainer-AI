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

- [Runtime Engine](runtime.md) — Core event lifecycles, states, and execution loops.
- [Persistence Layer](persistence.md) — Relational datastore schema, migrations, SQLite fallbacks, and pgvector embeddings.
- [Platform Integrations](integrations.md) — How the Integration Adapter Layer keeps repository logic channel-independent.
- [Observability & Telemetry](deployment.md) — Deployment configurations and structured logging.
