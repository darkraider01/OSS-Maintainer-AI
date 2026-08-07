# OSS-Maintainer-AI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![CI Build](https://github.com/darkraider01/OSS-Maintainer-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/darkraider01/OSS-Maintainer-AI/actions)
[![Issues](https://img.shields.io/github/issues/darkraider01/OSS-Maintainer-AI.svg)](https://github.com/darkraider01/OSS-Maintainer-AI/issues)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/darkraider01/OSS-Maintainer-AI/pulls)

An autonomous, multi-platform AI co-maintainer designed to automate workflows and assist open source project maintenance. Built on top of the Caspian SDK.

For a detailed review of components, containers, lifecycles, and deployment layouts, see our [C4 Architecture Documentation](docs/architecture/README.md).

---

## Elevator Pitch

OSS-Maintainer-AI acts as a tireless background developer and curator for open-source repositories. By linking code review triggers, messaging interfaces, and execution environments into a unified workspace, it autonomously triages issues, reviews pull requests, runs lint check reports, answers contributor questions, and manages codebase knowledge. This mitigates maintainer burnout and keeps projects responsive.

---

## Why OSS-Maintainer-AI?

Open-source project success is often bottlenecked by human bandwidth:
* **Maintainer Burnout**: Repetitive issue triaging, checking code styles, and explaining basic issues consumes cognitive energy.
* **Contributor Onboarding Friction**: New contributors struggle with environment setup or local guidelines, causing delay.
* **Knowledge Fragmentation**: Design choices (ADRs), documentation, and past issues remain scattered, causing duplicate queries.

OSS-Maintainer-AI addresses these challenges by acting as a **context-aware agent** that runs local tools (compilers, git, test runners) to provide high-quality feedback, answer developer questions, and flag security issues before human review.

---

## Features

### Implemented (Current State)
* **Caspian Ingress**: Inbound messages arrive through the Caspian gateway in either polling or webhook mode, with HMAC signature verification and event de-duplication on the webhook path.
* **GitHub Channel**: The first integration — issue and pull-request comments are normalized into the Unified Event Model and answered on the same thread.
* **Integration Adapter Layer**: Channel-specific normalization lives entirely in `src/gateway/adapters/`; the orchestrator only ever sees unified events.
* **Scalable Data Schema**: Dialect-independent database schemas (PostgreSQL / SQLite) mapping versioned workflows, actors, executions, traces, and chunked vector embeddings.
* **Dual Dialect Client**: PostgreSQL connector using `pg` for production, and `better-sqlite3` for local development.
* **Trace Engine**: Structured tables capturing raw execution logs, observations, and tool parameters.
* **CI Validation**: Automated GitHub Action pipelines for formatting, linting, type-safety checks, and unit testing.

### Planned (Immediate Roadmap)
* **Issue Triage Agent**: Replace the echo responder with real orchestration on the event bus.
* **Additional Channels**: Slack, Discord, and Email adapters over the same gateway.
* **Memory & RAG Indexing**: Local Markdown file vector extraction using `pgvector` for semantic context search.

---

## Architecture

OSS-Maintainer-AI separates platform-specific integrations from core orchestration logic, relying on the **Caspian SDK** as its foundational runtime layer.

### High-Level System Architecture

This diagram illustrates how external platforms interact with the system and how the persistence layer acts as a backing datastore.

```mermaid
graph TD
    subgraph Platforms [Event Sources]
        GH[GitHub]
        GL[GitLab]
        SL[Slack]
        DC[Discord]
        EM[Email]
        JR[Jira]
        LN[Linear]
    end

    subgraph Adapters [Integration Adapter Layer]
        GHA[GitHub Adapter]
        GLA[GitLab Adapter]
        SLA[Slack Adapter]
        DCA[Discord Adapter]
        EMA[Email Adapter]
        JRA[Jira Adapter]
        LNA[Linear Adapter]
    end

    subgraph Core [OSS-Maintainer-AI Engine]
        GW[Unified Event Gateway]
        EN[Event Normalization Layer]
        BUS[Internal Event Bus]
        OR[Orchestrator Core]
        
        GW --> EN
        EN --> BUS
        BUS --> OR
    end

    subgraph Runtime [Caspian SDK Runtime Layer]
        OR --> SDK[Caspian SDK Engine]
        SDK --> LLM[Model Provider Abstraction]
    end

    subgraph Tooling [External Tool Execution]
        SDK --> Tools[Git / Filesystem / Package Managers]
    end

    subgraph Persistence [Database Layer]
        DB[(PostgreSQL - Structured Ops)]
        DEV[(SQLite - Local Dev)]
        VEC[(pgvector - Semantic Search)]
    end

    GH --> GHA
    GL --> GLA
    SL --> SLA
    DC --> DCA
    EM --> EMA
    JR --> JRA
    LN --> LNA

    GHA --> GW
    GLA --> GW
    SLA --> GW
    DCA --> GW
    EMA --> GW
    JRA --> GW
    LNA --> GW

    OR -.-> DB
    OR -.-> DEV
    OR -.-> VEC
```

---

### Internal Component Architecture

This diagram details the internal runtime execution loop, tracing how events flow through normalization, execution engines, agents, context construction, and tool router cycles.

```mermaid
graph TD
    subgraph Input [Ingress]
        Event[External Event] --> Gateway[Event Gateway]
        Gateway --> Normalizer[Event Normalizer]
        Normalizer --> EventBus[Internal Event Bus]
    end

    subgraph Orchestration [Orchestrator Core]
        EventBus --> Orchestrator[Orchestrator]
        Orchestrator --> Workflows[Workflow Template Engine]
        Workflows --> ExecState[Execution State Manager]
    end

    subgraph AgentRuntime [Caspian Agent Runtime]
        ExecState --> CaspianSDK[Caspian SDK Runtime]
        CaspianSDK --> Executor[Agent Executor]
    end

    subgraph Context [Cognitive Context Assembly]
        Executor --> Memory[Memory Service]
        Executor --> Knowledge[Knowledge Base / RAG]
        
        Memory --> ContextBuilder[Context Builder]
        Knowledge --> ContextBuilder
        ContextBuilder --> Prompts[Prompt Builder]
    end

    subgraph Model [Model Runtime Layer]
        Prompts --> LLM[Model Provider Abstraction]
    end

    subgraph ExecutionLoop [Tool Execution Loop]
        LLM -- Request Tool --> Router[Tool Router]
        
        Router --> GH_API[GitHub API]
        Router --> FS[Workspace / Filesystem]
        Router --> Search[Web Search]
        Router --> Custom[Custom Tools]

        GH_API -- Return Observation --> CaspianSDK
        FS -- Return Observation --> CaspianSDK
        Search -- Return Observation --> CaspianSDK
        Custom -- Return Observation --> CaspianSDK

        LLM -- Final Output --> Artifacts[Execution Artifacts]
    end

    subgraph DB [Persistence Layer]
        Relational[(PostgreSQL / SQLite)]
        Vector[(pgvector Store)]
    end

    subgraph Observability [Observability Engine]
        Log[Logging - Pino]
        Met[Metrics]
        Trace[Tracing]
    end

    Orchestrator -.-> Relational
    Context -.-> Vector
    Orchestration -.-> Observability
    AgentRuntime -.-> Observability
    ExecutionLoop -.-> Observability
```

---

### Component Responsibilities

1. **OSS-Maintainer-AI Core**: Responsible for defining workflow templates (`WorkflowTemplate`), managing versioned steps (`WorkflowVersion`), orchestrating execution run-states (`ExecutionState`), building user prompt templates, formatting outputs, and emitting telemetry metrics.
2. **Caspian SDK Runtime**: Manages the message polling loop and handles interaction loops between agent executors and LLM providers. It abstracts provider SDK schemas (OpenAI, Anthropic, Gemini) and resolves tools requested by models.
3. **Integration Isolation**: External communication channels and repository providers are isolated from the orchestrator runtime using the **Integration Adapter Layer**. Platform events are parsed into a normalized internal scheme before hitting the gateway. Adding GitLab or Jira requires writing a custom integration adapter without modifying the core orchestrator or memory layouts.
4. **Decoupled Context, Memory, & Knowledge**: Memory (session histories) and Knowledge Bases (indexed documents) are implemented as independent helper services. The `Context Builder` combines these nodes before passing them to the `Prompt Builder` for LLM compilation, preventing LLM provider dependencies from bleeding into storage layouts.

---

## Technology Stack

* **Caspian SDK**: Chosen as the communication broker. It abstracts away Slack, Discord, and Email API quirks into a single messaging interface.
* **TypeScript & Node.js (18+)**: Strongly-typed compiler environment for clean application design.
* **Drizzle ORM**: Declares type-safe SQL schemas with native vector mapping support.
* **PostgreSQL (with `pgvector`)**: Relational database storing metadata alongside high-dimension embeddings for semantic search.
* **SQLite (`better-sqlite3`)**: Zero-dependency database driver fallback for local testing.
* **pnpm**: Fast package dependency installation using hard links.
* **Vitest**: ESM-native test runner.
* **Pino**: High-performance JSON logger.
* **Zod**: Runtime environment schema validation on boot.

---

## Getting Started

### Prerequisites
- Node.js (v18+)
- pnpm (v11+)
- PostgreSQL (with `pgvector` extension) *or* SQLite (local)

### Installation
```bash
# Clone the repository
git clone https://github.com/darkraider01/OSS-Maintainer-AI.git
cd OSS-Maintainer-AI

# Install dependencies
pnpm install
```

### Environment Configuration
Copy `.env.example` to `.env` and fill out your variables:
```bash
cp .env.example .env
```

### Database Migrations
Run the Drizzle migrations to set up your tables:
```bash
pnpm exec drizzle-kit push
```

### Connect the GitHub Channel
Provision the Caspian GitHub channel, then open the printed `authorize_url` to install the App
on your repositories:
```bash
pnpm run caspian:connect-github
```

See [docs/runbooks/caspian-github.md](docs/runbooks/caspian-github.md) for the full setup,
webhook configuration, and the end-to-end verification steps.

### Execution Commands
```bash
pnpm run dev                    # Run locally
pnpm run caspian:connect-github # Provision the Caspian GitHub channel
pnpm run build                  # Compile to JavaScript
pnpm run test                   # Run unit tests
pnpm run lint                   # Check code quality
pnpm run format:check           # Verify formatting
```

---

## Repository Structure

```
OSS-Maintainer-AI/
├── .github/                 # Workflows (CI, Security Audits) & PR/Issue templates
├── docs/                    # System Vision, Roadmap, and Architectural Decisions (ADRs)
├── src/
│   ├── cli/                 # Operator commands (channel provisioning)
│   ├── config/              # Environment parser, Logger setup, system constants
│   ├── db/                  # Drizzle database client & migrations
│   │   ├── schema/          # Split tables (actors, messages, executions, embeddings)
│   ├── domain/              # Persistence-independent core domain structures
│   ├── gateway/             # Caspian ingress, Unified Event Model, internal event bus
│   │   ├── adapters/        # Per-platform normalization (GitHub first)
│   │   └── caspian/         # SDK client, message builders, webhook signatures
│   ├── shared/              # Common helper routines
│   ├── core/                # Orchestration workflows & event handlers
│   ├── types/               # TypeScript compiler interfaces
│   └── index.ts             # Application entry point
├── tests/                   # Integration & unit tests
├── drizzle.config.ts        # Drizzle kit configuration file
└── package.json             # Core dependency manifest
```

---

## Roadmap

- [x] Repository Bootstrap
- [x] Persistence Layer (Drizzle + pgvector)
- [x] Caspian SDK Broker Integration
- [x] GitHub Integration
- [ ] Memory & RAG Indexing
- [ ] Issue Triage Agent
- [ ] PR Review Agent
- [ ] Multi-Agent Orchestration Workflows
- [ ] GitLab, Slack, and Discord Connectors

---

## Contributing

We welcome contributions! Please review our guides to get started:
* [CONTRIBUTING.md](CONTRIBUTING.md) — Git workflow and commit conventions.
* [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Pledge of inclusion.
* [SECURITY.md](SECURITY.md) — Vulnerability reporting policy.

---

## Built With

OSS-Maintainer-AI is an independent open-source project built using the [Caspian SDK](https://github.com/TryCaspian/caspian-sdk). We give special thanks to the TryCaspian team for creating and maintaining the SDK that powers this project's communication layer.

---

## License

Distributed under the [MIT License](LICENSE).
