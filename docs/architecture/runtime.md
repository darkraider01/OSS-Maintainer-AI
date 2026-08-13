# Runtime Engine Lifecycles

> **Note on accuracy:** this document describes the original, more
> elaborate design (a generic `WorkflowTemplate`/`Execution State Manager`/
> `Tool Router` runtime). What's actually implemented is narrower and
> conversation-state-based rather than execution-record-based — see
> [workflows.md](workflows.md) for the real routing (`WorkflowRouter` +
> `MaintainerAgent`, not a generic orchestrator) and
> [reliability.md](reliability.md) for the real retry/degradation behavior.
> The `executions`/`execution_events`/`tool_calls` tables referenced below
> exist in the schema but aren't populated by the current implementation —
> conversation/escalation/triage state lives on `conversations` columns
> instead (see `docs/implementation/remaining-work.md` for why).

## 1. Event Ingress Lifecycle

- **Webhook Ingestion**: An incoming webhook hits `Event Gateway`.
- **Signature Verification**: The gateway checks token payloads for validity.
- **Normalization**: The `Event Normalizer` maps the fields to the `Unified Event Model`.
- **Enqueue**: The event is published to the `Internal Event Bus`.

---

## 2. Orchestration & Execution Lifecycle

- **Workflow Resolution**: The `Orchestrator` fetches the event from the queue and selects the active `WorkflowTemplate`.
- **Execution Init**: The `Execution State Manager` creates an execution run instance.
- **Agent Binding**: The workflow instantiates the trigger agent, referencing prompt and config settings.

---

## 3. Agent Execution Loop (Caspian Agent Runtime)

The `Agent Executor` enters an execution loop coordinates steps with the Caspian SDK:

1.  **Context Construction**: The executor queries the `Memory Service` and `Knowledge Service` for relevant vector embeddings using pgvector.
2.  **Prompt Compilation**: The gathered context is compiled by the `Prompt Builder` and sent to the `Model Provider Abstraction`.
3.  **Model Invocation**: The LLM evaluates the prompt.
4.  **Tool Routing**: If the LLM requests a tool:
    - The parameters are routed via the `Tool Router`.
    - The action outcomes (observations) are formatted as message inputs.
    - The loop continues until the model returns a final text response.
5.  **Completion**: The `Execution State Manager` records the final output state and outputs the resulting markdown/JSON artifacts to the datastore.
