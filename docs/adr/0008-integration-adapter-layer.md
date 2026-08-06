# ADR-0008: Integration Adapter Layer and Unified Event Model

## Context and Problem

We need to support multiple communications and code collaboration platforms (GitHub, Slack, Linear) without modifying core orchestrator logic for each platform.

## Decision

We will introduce an Integration Adapter Layer to parse platform events into a Unified Event Model before they enter the system.

## Status

Accepted

## Consequences

- Core orchestrator and agent tables are decoupled from platform-specific schemas.
- Adding a new integration only requires building a new adapter to convert payloads to the unified event schema.
