# Sequence Trace: Issue Triage

## Sequence Trace

Issue Triage (#18) never auto-labels, auto-assigns, or auto-creates a GitHub
issue. It collects the required fields (reproduction steps, logs, SDK
version, OS, environment details) across turns and only _proposes_ an issue
once complete — a maintainer confirms before any GitHub write happens (PRD
§7 / §21, "prefer confirmation before external side effects"). The sequence
below reflects that: intent classification and the WorkflowRouter dispatch
to `TriageWorkflow`, which runs structural (regex-based, not LLM-only) field
extraction against `IssueTriageState`, persisted per-conversation.

```mermaid
sequenceDiagram
    autonumber
    actor Contributor as Contributor
    participant GH as Git Platform API
    participant GW as Event Gateway
    participant EN as Event Normalizer
    participant MA as MaintainerAgent
    participant IC as Intent Classifier
    participant WR as WorkflowRouter
    participant TW as TriageWorkflow
    participant DB as Conversation State (triage_state)

    Contributor->>GH: Open Issue ("The SDK crashes when I call connect()")
    GH->>GW: Inbound Webhook event
    GW->>EN: Normalize payload
    EN->>MA: Dispatch Unified Event

    MA->>IC: classify(text)
    IC-->>MA: intent = bug_report, confidence

    MA->>WR: route(bug_report)
    WR-->>MA: TriageWorkflow

    MA->>TW: execute(context, classification)
    TW->>DB: load prior IssueTriageState (if any)
    TW->>TW: extract fields, compute missingFields
    TW->>DB: save updated IssueTriageState

    alt fields still missing
        TW-->>Contributor: "Could you provide: SDK version, OS, logs, ..."
    else all fields collected
        TW-->>Contributor: "I have everything needed — reply to confirm, a maintainer will open the issue (not created automatically)"
    end
```
