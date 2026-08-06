# ADR-0004: Event-Driven Architecture

## Context and Problem

We need a decoupled communication pattern to handle webhook events from multiple platforms (GitHub, Slack, Linear) without locking the runtime thread or blocking requests.

## Decision

We will employ an Event-Driven Architecture (EDA) using an internal asynchronous Event Bus to process normalized payload events.

## Status

Accepted

## Consequences

- Webhook endpoints can respond immediately with a `202 Accepted` status after publishing to the queue.
- Orchestrator components are fully isolated from inbound request routing.
- Provides a path for distributed deployment configurations in the future using Redis or RabbitMQ queues.
