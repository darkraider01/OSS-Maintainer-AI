# ADR-0007: Drizzle ORM

## Context and Problem

We need an ORM to manage database interactions, handle schema migrations, and preserve TypeScript type safety.

## Decision

We will use Drizzle ORM to define schemas and manage migrations.

## Status

Accepted

## Consequences

- Declaring schemas in TypeScript serves as the single source of truth for our database types.
- Native support for custom data types allows us to define the `vector` type.
- Direct SQL compilation results in minimal runtime overhead.
