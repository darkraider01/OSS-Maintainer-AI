# Configuration Reference

Every variable lives in [`.env.example`](../.env.example) with an inline
comment — this doc groups them by feature instead, so "what do I need to set
to turn X on" has one answer. `src/config/env.ts` validates all of it at
startup (Zod) and fails fast with a specific missing-variable error rather
than a mysterious runtime failure.

| Feature                        | Required when                       | Variables                                                                                                                                                                                                                |
| ------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Caspian (Slack/Discord)        | Always (has defaults for demo mode) | `CASPIAN_API_KEY`, `CASPIAN_BASE_URL`, `CASPIAN_INGRESS_MODE`, `CASPIAN_ENABLED_CHANNELS`                                                                                                                                |
| Direct GitHub channel          | `GITHUB_ENABLED=true`               | `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_RECEIVE_MODE` — see the README's "GitHub Integration" section for the full App-creation walkthrough |
| Account-linking dashboard      | `AUTH_ENABLED=true`                 | `AUTH_BASE_URL`, `GITHUB_OAUTH_CLIENT_ID/SECRET`, `SLACK_OAUTH_CLIENT_ID/SECRET`, `DISCORD_OAUTH_CLIENT_ID/SECRET`                                                                                                       |
| LLM provider                   | Always (defaults to mock)           | `DEMO_MODE`, `LLM_PROVIDER`, `LLM_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`, `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`                                                                    |
| Escalation notification        | Optional, per provider              | `MAINTAINER_GITHUB_USERNAME`, `MAINTAINER_SLACK_MENTION`, `MAINTAINER_DISCORD_MENTION` — see [architecture/workflows.md](architecture/workflows.md#human-escalation-20)                                                  |
| Contributor stats on dashboard | Optional                            | `GITHUB_STATS_REPO`                                                                                                                                                                                                      |
| Logging                        | Always                              | `LOG_LEVEL`                                                                                                                                                                                                              |

## Database

No dedicated env var beyond `DATABASE_URL` — `src/db/client.ts` picks
Postgres when `DATABASE_URL` is set or `NODE_ENV=production`, SQLite
(`local_dev.db`, or `SQLITE_DB_PATH`) otherwise. Zero-config demo mode never
needs `DATABASE_URL` at all.

## Load testing

`src/cli/load-test.ts` reads `LOG_LEVEL` (set it to `fatal` — see
[`docs/performance/load-test-report.md`](performance/load-test-report.md)
for why) but takes its actual parameters as CLI flags
(`--conversations`, `--concurrency`, `--repos`, `--channel`, `--textStyle`),
not env vars.

## Validation failures are specific, not generic

Setting `GITHUB_ENABLED=true` without also setting all four required GitHub
variables fails startup with exactly which ones are missing, not a generic
"invalid config" — same for `AUTH_ENABLED=true` and
`CASPIAN_INGRESS_MODE=webhook` (needs `CASPIAN_WEBHOOK_SECRET`). See the
`if (result.data.X_ENABLED)` blocks at the bottom of `src/config/env.ts`.
