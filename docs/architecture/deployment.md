# Production Deployment & Infrastructure Topology

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
