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

Platform transports are terminated by **Caspian**, so the gateway sees one normalized message shape
per channel rather than one webhook schema per platform.

---

## Caspian Ingress

`CaspianGateway` (`src/gateway/caspian-gateway.ts`) is the single entry point for inbound messages.
Two transports converge on it:

| Mode | Entry point | Use |
| --- | --- | --- |
| `poll` | `client.onMessage` → `gateway.ingest` | Long-lived process; no public URL |
| `webhook` | `POST /webhooks/caspian` → `gateway.handleWebhook` → `gateway.ingest` | Serverless / autoscaled deployments |

Both paths produce an `InboundMessage`, which is what adapters consume — nothing downstream of the
gateway depends on the SDK's classes or on which transport delivered the event.

Webhook deliveries are verified as HMAC-SHA256 over the raw request body against the
`x-caspian-signature` header, in constant time, before the payload is parsed. Already-seen event ids
are dropped, so a gateway retry cannot double-post a reply.

Channels are gated by `CASPIAN_ENABLED_CHANNELS`. A message on a channel that is disabled, or that
has no registered adapter, is logged and dropped rather than guessed at.

---

## Unified Event Model

The normalized internal event follows a standard schema (`src/gateway/unified-event.ts`):

- `actorReference`: Identifies the sender mapping to a unified actor.
- `conversationReference`: Maps to channel identifiers.
- `payloadType`: Indicates the action type (`issue_created`, `pr_opened`, `message_sent`).
- `rawPayload`: The original integration JSON data, preserved in a JSONB field for platform-specific queries.

Events reach subscribers wrapped in an `EventEnvelope`, which pairs the event with a `respond`
callback bound to the originating conversation. Subscribers reply through that callback and never
import the Caspian SDK, which keeps egress reversible per channel.

---

## Adding a New Platform Integration

To add a new platform (e.g. GitLab):

1.  Declare the platform key in `provider` enum configurations.
2.  Create an adapter under `src/gateway/adapters/gitlab.ts` implementing `IntegrationAdapter`.
3.  Register it in `createDefaultRegistry()` and add the channel to `CASPIAN_ENABLED_CHANNELS`.
4.  No changes are made to the core Orchestrator, Agents, RAG, or Memory databases.
