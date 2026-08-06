# ADR-0002: Technology Stack and Tooling

## Context and Problem

We need to configure a stable, scalable, developer-friendly technology stack for bootstrapping the TypeScript repository.

## Decisions

### 1. Caspian SDK

We will build directly on the Caspian SDK communication client. Since the official Caspian SDK offers first-class TypeScript interfaces, using TS ensures high type parity and compile-time verification.

### 2. pnpm Package Manager

We chose `pnpm` over standard npm because:

- Faster installation via content-addressable storage.
- Strict layout prevents phantom dependency imports.
- Built-in workspaces allow monorepo scaling in the future.

### 3. Vitest Test Runner

We chose `Vitest` instead of Jest:

- Native ESM support.
- Zero-config integration with TypeScript and module resolution.
- Extremely fast execution times.

### 4. ESLint & Prettier

We evaluated Biome as a replacement for ESLint + Prettier. While Biome is faster, ESLint and Prettier are the standard in mainstream open-source communities. To avoid friction for contributors using standard IDE configurations, and to support plugins (like Husky, commitlint), we decided to stick with the classic ESLint + Prettier combination.

## Status

Accepted
