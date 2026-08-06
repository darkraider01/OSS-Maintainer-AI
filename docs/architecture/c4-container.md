# C4 Level 2: Container Diagram

## System Container Diagram

The Container diagram details the runtime services and container boundaries that make up the **OSS-Maintainer-AI** project.

```mermaid
graph TD
    subgraph Ingress [Ingress & Adapters]
        GW[Event Gateway] --> Normalizer[Event Normalization Layer]
        Normalizer --> EventBus[Internal Event Bus]
    end

    subgraph Core [OSS-Maintainer-AI Core Engine]
        EventBus --> Orchestrator[Orchestrator]
        Orchestrator --> WorkflowEngine[Workflow Template Engine]
        WorkflowEngine --> ExecState[Execution State Manager]
    end

    subgraph Runtime [Caspian SDK Runtime]
        ExecState --> CaspianSDK[Caspian SDK Engine]
        CaspianSDK --> AgentExecutor[Agent Executor]
    end

    subgraph Context [Cognitive Context Containers]
        AgentExecutor --> MemoryService[Memory Service]
        AgentExecutor --> KnowledgeService[Knowledge Service / RAG]

        MemoryService --> ContextBuilder[Context Builder]
        KnowledgeService --> ContextBuilder
        ContextBuilder --> PromptBuilder[Prompt Builder]
    end

    subgraph Providers [Model Runtime Container]
        PromptBuilder --> ModelRuntime[Model Runtime / LLM Abstraction]
    end

    subgraph ExecutionLoop [Tool Routing Container]
        ModelRuntime -- Request Tool --> ToolRouter[Tool Router]
        ToolRouter -- Return Observation --> CaspianSDK
    end

    subgraph Storage [Persistence Containers]
        DB[(PostgreSQL / SQLite)]
        VEC[(pgvector Embedding Store)]
    end

    subgraph Telemetry [Observability Container]
        Obs[Observability Engine]
    end

    Orchestrator -.-> DB
    Context -.-> VEC
    Core -.-> Obs
    Runtime -.-> Obs
```

---

## Containers Breakdown

1.  **Event Gateway**: The API endpoint listening to webhooks and inputs.
2.  **Event Normalization Layer**: Formats provider payloads into a unified format.
3.  **Event Bus**: An in-memory queue that decouples ingest loops from orchestration execution.
4.  **Orchestrator**: Evaluates normalized events and coordinates templates.
5.  **Workflow Template Engine**: Resolves steps mapped in template configurations.
6.  **Execution State Manager**: Manages transaction runs, retry limits, checkpoints, and execution states.
7.  **Caspian SDK Engine**: Manages communication channels and loops.
8.  **Agent Executor**: Resolves the agent's logic run.
9.  **Memory & Knowledge Services**: Provide short-term and long-term context.
10. **Context & Prompt Builders**: Gathers context into a unified prompt layout.
11. **Model Runtime**: Abstracts LLM APIs.
12. **Tool Router**: Dynamic dispatcher triggering filesystem, search, or Git tools.
