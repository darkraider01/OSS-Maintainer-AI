# Contributing to OSS-Maintainer-AI

We welcome community contributions to build the best AI-powered open source maintainer helper.

## Code Standards
We use **ESLint** and **Prettier** to check linting and formatting. Run checks locally before pushing:
```bash
pnpm run lint
pnpm run format:check
pnpm run typecheck
```

## Git Guidelines

### Branch Naming
- Features: `feat/some-feature`
- Fixes: `fix/some-bug`
- Chore/Docs: `chore/some-docs`

### Commit Message Conventions
Commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) schema:
```
<type>(<scope>): <description>

[optional body]
```
Examples:
- `feat(gateway): add input validation`
- `fix(github): handle rate limits on issues fetch`

We run `commitlint` inside git hooks to enforce these validation rules.

## Release Management
We use `@changesets/cli` to handle versioning. When you make a pull request that needs a release, run:
```bash
pnpm changeset
```
Follow the CLI instructions to add a description of your change and commit the generated Markdown file.
