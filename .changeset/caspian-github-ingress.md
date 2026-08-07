---
'oss-maintainer-ai': minor
---

Integrate the Caspian SDK for a single channel, starting with GitHub (FR-1).

Adds a `CaspianGateway` that accepts inbound messages in either polling or webhook mode,
normalizes them through the Integration Adapter Layer into the Unified Event Model, and publishes
them onto an internal event bus. Webhook deliveries are signature-verified and de-duplicated. A
GitHub adapter and an echo responder complete the loop end to end, and
`pnpm run caspian:connect-github` provisions the channel.
