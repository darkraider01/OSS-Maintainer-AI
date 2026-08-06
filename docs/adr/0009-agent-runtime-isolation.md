# ADR-0009: Agent Runtime and Caspian SDK Isolation

## Context and Problem

We need to run agent workflows while keeping them decoupled from specific LLM provider APIs or webhook details.

## Decision

We will isolate the Agent Runtime within the Caspian SDK boundary, letting the Caspian engine handle LLM invocation, streaming, and tool resolution.

## Status

Accepted

## Consequences

- The orchestrator only manages high-level templates and states.
- Re-running executions or changing models does not require changes to core orchestrator components.
