# ADR-0005: C4 Architecture Documentation Model

## Context and Problem

Open-source projects often lack structured architectural layouts, making onboarding difficult for new contributors. We need a clear documentation framework.

## Decision

We will adopt the C4 Model (Context, Containers, Components) to structure our architecture documentation under `docs/architecture/`.

## Status

Accepted

## Consequences

- The system design is documented at multiple levels of abstraction.
- New developers can understand the boundaries before diving into code.
- Mermaid diagrams are embedded directly to ensure automated rendering on GitHub.
