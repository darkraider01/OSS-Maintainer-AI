# Runbook: Caspian GitHub Channel (FR-1)

How to connect OSS-Maintainer-AI to Caspian with GitHub as the first channel, and how to verify
end to end that a message received through Caspian gets an answer back through Caspian.

---

## 1. Credentials

```bash
cp .env.example .env
```

Get an API key with the Caspian CLI (`pip install caspian-sdk && caspian init`) or from
[trycaspianai.com](https://trycaspianai.com), then set:

```
CASPIAN_API_KEY=csk_...
```

The legacy `COMM_API_KEY` / `COMM_BASE_URL` names still work — the SDK and this application both
prefer `CASPIAN_*` and fall back to `COMM_*`.

---

## 2. Connect the GitHub channel

```bash
pnpm run caspian:connect-github
```

Two modes, chosen automatically:

| Mode | When | What happens |
| --- | --- | --- |
| Shared App install | `GITHUB_APP_*` unset | `installGitHub()` — one-click install of Caspian's GitHub App |
| Bring your own App | `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` all set | `connectGitHub()` — your App, pointed at the gateway's setup/webhook URLs |

Both print an `authorize_url`. Open it and grant the App access to the repositories the agent
should watch. Nothing is provisioned until that install is approved on GitHub.

`GITHUB_RECEIVE_MODE` controls what reaches the agent:

- `mentions` (default) — only comments that `@`-mention the agent.
- `all` — every issue and pull-request comment on installed repositories.

> A bring-your-own App must subscribe to `issue_comment` events, or nothing will be delivered.

---

## 3. Choose an ingress mode

### Poll (default)

The process holds a long-lived event loop against the gateway. No public URL, no inbound
firewall rule.

```
CASPIAN_INGRESS_MODE=poll
```

```bash
pnpm run dev
```

### Webhook

The gateway pushes deliveries to an HTTP endpoint. Use this on serverless or autoscaled
deployments.

```
CASPIAN_INGRESS_MODE=webhook
CASPIAN_WEBHOOK_SECRET=<a long random string>
CASPIAN_WEBHOOK_URL=https://your-host.example.com/webhooks/caspian
PORT=3000
```

`pnpm run caspian:connect-github` registers that URL and secret with the gateway
(`setWebhook`). Every delivery is verified as HMAC-SHA256 over the raw body against
`x-caspian-signature`, and replayed events are dropped.

Health probe: `GET /healthz`.

---

## 4. Verify end to end

1. Start the process (`pnpm run dev`). Look for `Caspian gateway registered`.
2. Comment on an issue in an installed repository, mentioning the agent:
   `@your-agent-name hello from FR-1`.
3. The log shows `Inbound event normalized` followed by `Echo reply sent through Caspian`.
4. A reply appears on the same GitHub thread:

   ```
   OSS-Maintainer-AI received your message via github.
   Sender: your-github-login
   Type: issue_comment_created

   > @your-agent-name hello from FR-1
   ```

The echo confirms the full loop: GitHub → Caspian → adapter → Unified Event → event bus →
reply → Caspian → GitHub. It is a placeholder, and gets replaced by orchestrator routing once
the triage agent lands.

### Without a live gateway

The same loop is covered offline by the test suite:

```bash
pnpm test
```

`tests/gateway/webhook-server.test.ts` posts a real signed delivery to a real HTTP server and
asserts the echo goes back out on the originating message.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Environment validation failed: CASPIAN_API_KEY` | No key in `.env` or the environment |
| `CASPIAN_WEBHOOK_SECRET is required when CASPIAN_INGRESS_MODE=webhook` | Webhook mode without a secret |
| 401 `invalid_signature` | `CASPIAN_WEBHOOK_SECRET` differs from the secret registered via `setWebhook` |
| `Channel not enabled; dropping message` | The channel is missing from `CASPIAN_ENABLED_CHANNELS` |
| `No adapter registered for channel` | The channel is enabled but has no adapter in `src/gateway/adapters/` |
| Comments never arrive | The App is not installed on that repository, or `GITHUB_RECEIVE_MODE=mentions` and the comment has no mention |
