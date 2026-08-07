# Live Demo Screenshots & Assets Guide

This directory contains placeholders and guidelines for capturing visual proof of your live workspace demonstrations.

---

## Suggested Capture Sequence

For a complete product walk-through, capture screenshots in the following order:

1. **Slack Discussion**: Send a message like `@maintainer-agent how does the gateway work?` in your Slack test channel.
2. **Gateway Terminal logs**: Capture the clean console execution logs showing the ingestion, deduplication, mapping, and reply egress.
3. **Slack Response**: Capture the thread response outputted back onto the Slack channel by the agent.
4. **GitHub Issue**: Create a GitHub issue asking a question.
5. **GitHub Agent Response**: Capture the response comment left on the issue thread.
6. **Unified Event Database**: View the sqlite database tables `conversations` or `messages` showing that both the Slack and GitHub threads are represented under the exact same schema.

---

## Placeholders Guidance

- `docs/demo/slack_request.png` — Visual of the message inside Slack client.
- `docs/demo/slack_response.png` — Agent reply displaying formatting rules.
- `docs/demo/github_response.png` — GitHub comment thread showing the agent's signature block.
- `docs/demo/terminal_trace.png` — Image of the clean console traces showing `[Runtime Execution Trace]`.
