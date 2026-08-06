# ADR-0003: Architecture Principles

## Context and Problem

We want to prevent OSS-Maintainer-AI from decaying into spaghetti code with tight coupling and circular references.

## Decisions

### 1. Inward Dependency Flow

All dependencies must flow inward towards the Domain and Types layer. The structure is separated as:

- Core/Orchestration logic depends on Domain concepts.
- External integrations (GitHub service, LLM providers) do not depend on the Orchestrator. They receive commands and return data objects conforming to Domain interfaces.

### 2. Postpone Module Stubs

We will avoid creating empty directory stubs (e.g. `gateway/`, `memory/`, `rag/`) until they are actively being implemented in a specific issue. This prevents git-tracking gaps and empty technical debt.

## Status

Accepted
