# Production Deployment & Infrastructure Topology

> **Note on accuracy:** the diagram below is the original target topology
> (Redis, an OpenTelemetry Collector, a standalone Prometheus + Grafana
> stack). None of that is deployed by this app itself today. What's real:
> a single Node process, Postgres (with pgvector) or SQLite, and a
> hand-rolled `GET /metrics` endpoint in Prometheus text format that an
> _external_ Prometheus server can scrape directly — see
> [observability.md](observability.md). No Redis, no event-bus process
> separate from the in-memory `EventBus` (`src/gateway/event-bus.ts`). Load
> characteristics actually measured against this current implementation are
> in [`docs/performance/load-test-report.md`](../performance/load-test-report.md).

## Deployment Diagram

The diagram below details the production deployment layout of **OSS-Maintainer-AI** on cloud infrastructure.

```mermaid
graph TB
    subgraph Client [External Clients]
        GH[GitHub Webhooks / APIs]
        SL[Slack APIs]
    end

    subgraph LB [Load Balancing]
        Ingress[Cloud Load Balancer]
    end

    subgraph Pods [Application Pods]
        App[OSS-Maintainer-AI Container Node]
    end

    subgraph Storage [Persistence Tier]
        PG[(PostgreSQL Database)]
        VEC[(pgvector Embedding Engine)]
        RD[(Redis - Cache & Event Bus - Future)]
    end

    subgraph Telemetry [Observability Infrastructure]
        OTEL[OpenTelemetry Collector]
        PROM[Prometheus TSDB]
        GRAF[Grafana Dashboards]
    end

    Client -- Webhook Ingress --> Ingress
    Ingress -- Forward --> App

    App -- SQL queries --> PG
    App -- Semantic searches --> VEC
    App -- Pub/Sub queues --> RD

    App -- Metric exports --> OTEL
    OTEL -- Write metrics --> PROM
    PROM -- Query metrics --> GRAF
```

---

## Infrastructure Specifications

1.  **Application Container Nodes**: Node.js/TypeScript execution environments running the Caspian SDK.
2.  **PostgreSQL**: Handles operational tables (`actors`, `conversations`, `executions`).
3.  **pgvector**: High dimension vector mapping extensions enabled natively inside PostgreSQL database.
4.  **Redis (Optional Future Upgrade)**: Planned for shared event bus queuing.
5.  **OpenTelemetry Collector**: Handles trace pipelines, error profiling, and execution telemetry.
