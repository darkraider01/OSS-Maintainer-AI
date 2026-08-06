# Platform Integrations & Ingress Routing

## Decoupled Platform Integrations

GitHub is only the first integration. The architecture is designed to support GitLab, Slack, Discord, Email, Jira, and Linear without requiring schema modifications to core domain tables.

---

## Integration Adapter Layer

Every platform integration is structured under an adapter boundary. The adapter is responsible for:

1.  Verifying payload signatures.
2.  Normalizing platform payloads (e.g. converting a Slack message event or GitHub issue webhook) into the **Unified Event Model**.
3.  Publishing the event to the **Internal Event Bus**.

```
GitHub Webhook ──> GitHub Adapter ──┐
Slack Event    ──> Slack Adapter   ──┼─> [Unified Event Gateway] ──> [Event Bus] ──> Orchestrator
Jira webhook   ──> Jira Adapter    ──┘
```

---

## Unified Event Model

The normalized internal event follows a standard schema:

- `actorReference`: Identifies the sender mapping to a unified actor.
- `conversationReference`: Maps to channel identifiers.
- `payloadType`: Indicates the action type (`issue_created`, `pr_opened`, `message_sent`).
- `rawPayload`: The original integration JSON data, preserved in a JSONB field for platform-specific queries.

---

## Adding a New Platform Integration

To add a new platform (e.g. GitLab):

1.  Declare the platform key in `provider` enum configurations.
2.  Create an adapter under `src/gateway/adapters/gitlab.ts` inheriting the base normalization classes.
3.  Bind the incoming webhook parser to route Git events to the unified schema.
4.  No changes are made to the core Orchestrator, Agents, RAG, or Memory databases.
