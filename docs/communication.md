# Communication Subsystem & Provider Channels

This document describes the design, mapping specifications, and expansion protocols for platform integrations inside `OSS-Maintainer-AI`.

---

## 1. Provider Architecture

Platform communication channels are routed through **Caspian** to decouple raw platform webhook payload details from the core agent orchestrator. The ingress gateway resolves communication through registered platform adapters:

```
                  ┌───────────────────────────────┐
                  │        Caspian Gateway        │
                  └───────────────┬───────────────┘
                                  │
                   Ingest message (InboundMessage)
                                  │
                  ┌───────────────▼───────────────┐
                  │    AdapterRegistry Resolve    │
                  └───────────────┬───────────────┘
                                  │
                    Select Adapter (by channel)
                                  │
                  ┌───────────────▼───────────────┐
                  │    Slack or GitHub Adapter    │
                  │   (normalizes to UnifiedEvent)│
                  └───────────────┬───────────────┘
                                  │
                  ┌───────────────▼───────────────┐
                  │     CommunicationService      │
                  │  (orchestrates deduplication, │
                  │  identity resolution, threads)│
                  └───────────────┬───────────────┘
                                  │
                  ┌───────────────▼───────────────┐
                  │           Event Bus           │
                  └───────────────────────────────┘
```

---

## 2. Supported Providers

- **GitHub** ✅ (Issues, Pull Requests, Comments)
- **Slack** ✅ (Channels, Threads, Mentions, Attachments)
- **Discord** (Planned)
- **Telegram** (Planned)
- **Email** (Planned)

---

## 3. Slack Event Normalization Mapping

| Inbound Payload Field    | Unified Event Property                 | Transformation / Resolving Logic                                 |
| :----------------------- | :------------------------------------- | :--------------------------------------------------------------- |
| `message.id`             | `id`                                   | Prefixes the unique message ID: `slack:${message.id}`            |
| `message.channel`        | `provider`                             | Hardcoded context: `'slack'`                                     |
| `message.text`           | `text`                                 | Clean string representation of the Slack message                 |
| `message.conversationId` | `conversationReference.conversationId` | Mapped directly onto the Slack Channel ID (e.g. `C12345`)        |
| `message.sender.id`      | `actorReference.providerActorId`       | Slack User ID (e.g. `U12345`)                                    |
| `message.sender.login`   | `actorReference.handle`                | Slack username/handle (e.g. `slackuser`)                         |
| `message.raw.thread_ts`  | `rawPayload.slack_reference.threadTs`  | Thread timestamp stored in raw payload for conversation grouping |

---

## 4. How to Add a New Provider (e.g., Discord)

To add another platform integration tomorrow:

1. **Create the Adapter File**:
   Add `src/gateway/adapters/discord.ts` implementing `IntegrationAdapter` (from `src/gateway/adapters/types.ts`).
2. **Register in Adapter Registry**:
   Import and register the Discord adapter in the default registry builder list in `src/gateway/adapters/registry.ts`.

No changes are required to `CommunicationService`, `Drizzle ORM` schemas, or any other downstream system component.
