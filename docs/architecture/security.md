# Security

Covers issue #26 (authentication and rate limiting) and the secret-hygiene
half of the same issue.

## Authentication

**Webhook endpoints** — signature verification, not a shared-nothing "trust
the request" model:

- Caspian: HMAC-SHA256 over the raw body against `x-caspian-signature`,
  constant-time compare (`src/gateway/caspian/webhook-signature.ts`).
- GitHub: HMAC-SHA256 against `X-Hub-Signature-256`
  (`src/gateway/github/webhook-signature.ts`), plus `X-GitHub-Event`/
  `X-GitHub-Delivery` header validation.

**Application APIs** — there isn't a general application API to protect.
This app is webhook ingress + an OAuth account-linking dashboard
(`AUTH_ENABLED=true`, see [configuration.md](../configuration.md)) + a
handful of read-only observability/analytics endpoints (`/metrics`,
`/analytics`). The dashboard uses real OAuth round-trips (no passwords, no
stored provider tokens — see the README's "Cross-Channel Identity Linking"
section). `/metrics` and `/analytics` are unauthenticated by design, same
posture as every other route here — there's no auth framework to hang a
credential check off without introducing one from scratch, which "reuse
existing abstractions, don't add frameworks" argues against. If those
shouldn't be publicly visible in your deployment, put them behind
network-level access control (VPC, firewall rule, reverse-proxy auth) —
that's a deployment-time decision, not something this app enforces itself.

## Rate limiting

`src/core/security/rate-limiter.ts` — a provider-independent sliding-window
limiter (same bounded-Map-with-eviction style as `DeduplicationService`, no
external dependency), applied at two layers:

- **HTTP edge** (`webhook-server.ts`) — per-IP+route, checked _before_
  signature verification so a flooding source fails fast: webhooks 30
  req/10s, `/auth/*` and `/analytics` 20 req/min (human-driven, not
  provider-driven, so a tighter budget). Returns `429` + `Retry-After`.
- **Ingestion** (`CommunicationService.ingest()`) — per-actor (20/min) and
  per-conversation (40/min), dropped the same way a duplicate event already
  is (there's no HTTP response to attach `429`/`Retry-After` to this deep in
  the pipeline). Protects the LLM/DB/GitHub-egress work downstream from one
  spamming actor or a flooded thread.

## Secrets

Audited directly (not assumed):

- `.env`/`.env.local`/etc. are gitignored; `.env.example` contains only
  placeholders (`your_x_here`, empty, or explicit mention-syntax examples)
  — enforced by a regression test
  (`tests/config/secret-hygiene.test.ts`) that fails if a real-secret-shaped
  value (GitHub PAT prefix, Slack token prefix, PEM header, long base64
  blob) ever lands there.
- No log call in the codebase includes an API key, private key, or OAuth
  token — traced end to end, not just spot-checked.
- `UnifiedEvent.rawPayload` (the full inbound webhook payload) is never
  persisted to the database — `MessagePersistenceService` only writes the
  extracted `content` field. A second regression test proves this by
  ingesting a message with a credential-shaped value in a field the app
  doesn't use, then asserting it never reaches the `messages` table.
- The GitHub App's private key is only ever read from `env.GITHUB_PRIVATE_KEY`
  into the Octokit auth strategy in-memory — never logged, never written to
  the database.
