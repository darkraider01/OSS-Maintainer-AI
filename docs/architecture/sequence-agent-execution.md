# Sequence Trace: Agent Execution

## Sequence Trace

The sequence diagram below traces the execution flow of an event from an external Git integration (e.g. GitHub Webhook) through normalization, orchestration, prompt compilation, LLM model invocation, tool routing, and response comments formatting.

```mermaid
sequenceDiagram
    autonumber
    actor Contributor as Contributor / Git Event
    participant GW as Event Gateway
    participant EN as Event Normalizer
    participant BUS as Event Bus
    participant OR as Orchestrator
    participant WF as Workflow Engine
    participant ES as Execution State
    participant AG as Agent Executor
    participant ME as Memory Service
    participant KS as Knowledge Service
    participant PB as Prompt Builder
    participant LLM as Model Provider Abstraction
    participant TR as Tool Router
    participant API as External Platform API

    Contributor->>GW: Trigger event (e.g., Pull Request Opened)
    GW->>EN: Forward raw webhook payload
    EN->>BUS: Publish normalized internal event
    BUS->>OR: Dispatch event payload
    OR->>WF: Load Workflow Template matching event type
    WF->>ES: Initialize Execution State (Status: Running)
    ES->>AG: Initialize Agent Executor loop

    loop Agent execution step
        AG->>ME: Retrieve memory chunks (Semantic search)
        ME-->>AG: Memory chunks
        AG->>KS: Retrieve knowledge sources (RAG vector chunks)
        KS-->>AG: Document chunks
        AG->>PB: Construct prompt (Inject memory & knowledge context)
        PB-->>AG: Assembled prompt string
        AG->>LLM: Invoke model with prompt
        LLM-->>AG: Model Output (Structured Tool Request)

        opt Execute requested tool
            AG->>TR: Dispatch tool arguments
            TR->>API: Execute tool (e.g., Git pull / File system read)
            API-->>TR: Return results/outcome
            TR-->>AG: Format tool outcome as observation
        end
    end

    AG->>ES: Mark execution as Completed (save artifacts)
    ES->>API: Push final review comment to GitHub PR / issue
    API-->>Contributor: Display response comment
```
