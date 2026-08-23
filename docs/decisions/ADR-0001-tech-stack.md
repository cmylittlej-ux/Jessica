# ADR-0001 — Foundation Tech Stack

- **Status**: Accepted
- **Date**: 2026-08-23
- **Phase**: 0

## Context

REOS Foundation MVP must be local-first, mock-driven, type-safe, easy to test and
easy to extend toward future Outlook / PropertyMe / Grow integrations (Spec §3).

## Decision

| Concern | Choice |
|---------|--------|
| Language | TypeScript (single-stack for the whole foundation) |
| Monorepo | pnpm workspace (`apps/*` + `packages/*`) |
| Frontend | Next.js 15+, React 19, App Router |
| UI | Tailwind CSS v4, shadcn/ui (added when first screens land in Phase 5) |
| Validation | Zod — every structured AI response must pass schema validation (Spec §9) |
| Database | PostgreSQL 16 (docker compose service `db`) |
| ORM | Drizzle ORM + drizzle-kit migrations (wired at Phase 1 start) |
| Testing | Vitest (unit/integration), Playwright (E2E, browsers downloaded before Phase 7) |
| Lint/Format | ESLint 9 flat config + Prettier |

Explicitly rejected for the foundation (YAGNI, Spec §3): Redis, Kafka,
microservices, Kubernetes, GraphQL, Elasticsearch, vector database.

## Consequences

- One language across UI/domain/AI layers keeps AI-agent development friction low.
- Connector + AI gateway seams are defined by interfaces from day one, so replacing
  mocks with real connectors later does not touch business logic.
- Postgres arrives via Docker Desktop; see ADR-0002 for the runtime decision.
