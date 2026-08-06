# ADR-0006: PostgreSQL and pgvector for Vector Search

## Context and Problem

We need to store vector embeddings for semantic search in our RAG and Memory pipelines.

## Decision

We will use PostgreSQL with the `pgvector` extension for storing and querying high-dimension embeddings in production.

## Status

Accepted

## Consequences

- Operational overhead is reduced by keeping structured data and vectors in the same database.
- Metadata filtering can be combined with semantic lookups in a single SQL query.
- Locally, developers can fall back to SQLite when pgvector is not needed.
