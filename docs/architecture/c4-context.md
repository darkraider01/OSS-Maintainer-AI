# C4 Level 1: System Context Diagram

## System Context Diagram

The System Context diagram illustrates the system boundaries, users (Maintainers, Contributors), integration targets (GitHub, GitLab, Slack, Discord, Jira, Linear), and external dependencies (Caspian SDK, LLM Providers).

```mermaid
graph TB
    subgraph Users [Project Contributors & Admins]
        M[Maintainer]
        C[Contributor]
    end

    subgraph Integrations [External Platforms]
        GH[GitHub / GitLab]
        IM[Slack / Discord / Email]
        PM[Jira / Linear]
    end

    subgraph System [System Boundary]
        OMA[OSS-Maintainer-AI Core Engine]
    end

    subgraph RuntimeBoundary [SDK & Runtime Provider]
        SDK[Caspian SDK Runtime]
    end

    subgraph Models [Cognitive AI Layer]
        LLM[LLM Provider API Abstraction]
    end

    M -- Review PR / Create Issues --> GH
    C -- Submit Contributions --> GH
    M -- Discuss with Agents --> IM
    M -- Manage Work Item Status --> PM

    GH -- Inbound Events --> OMA
    IM -- Inbound Events --> OMA
    PM -- Inbound Events --> OMA

    OMA -- Orchestrates --> SDK
    SDK -- Abstracted LLM Calls --> LLM
    SDK -- Actions / Comments --> GH
    SDK -- Notifications --> IM
```

---

## Boundaries & Scope

1.  **Maintainer & Contributor**: Standard users interacting with platforms.
2.  **External Platforms**: Input sources and target spaces where actions are executed.
3.  **OSS-Maintainer-AI**: The core orchestrator. It manages workflows, execution states, memories, and prompts. It has no direct knowledge of communication client details.
4.  **Caspian SDK**: The communication runtime layer. It normalize webhooks and implements tool routes.
5.  **LLM Providers**: External model hosting platforms (OpenAI, Anthropic, Gemini, Ollama, OpenRouter).
