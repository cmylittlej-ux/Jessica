# REOS — Real Estate AI OS

Foundation MVP. A local-first, mock-data-driven AI work system for Melbourne real
estate sales & property management. See `docs/architecture/system-overview.md`.

> **Status: Phase 0 — Engineering Foundation (in progress)**

## Prerequisites

- Node.js ≥ 22 (pnpm is provided via `corepack`, no manual install needed)
- Docker Desktop (for PostgreSQL) — install from <https://www.docker.com/products/docker-desktop/>
  and start it once before running database commands

## Quick start

```bash
# 1. start the database (requires Docker Desktop)
pnpm db:up

# 2. install dependencies
corepack pnpm install

# 3. run the web app
pnpm dev            # http://localhost:3000
```

Environment: copy `.env.example` to `.env.local` (never commit it — Spec §30).

## Quality gates (must all pass per Phase — Spec §35)

```bash
pnpm lint           # ESLint across all packages + web
pnpm typecheck      # tsc --noEmit in every package
pnpm test           # Vitest unit + integration
pnpm build          # Next.js production build
```

E2E (from Phase 7): `pnpm exec playwright install chromium` once, then `pnpm e2e`.

## Repository layout

```
apps/web             Next.js 15 UI (AI Home / Inbox / Tasks / Approvals / Case Detail / Property 360)
packages/db          Drizzle schema, migrations, seed            (Phase 1)
packages/domain      Core domain model                          (Phase 1)
packages/connectors  Email/Property/CRM abstractions + mocks    (Phase 2)
packages/ai          AIGateway, Zod schemas, context builder    (Phase 3)
packages/workflows   Inbound email + approval workflows         (Phase 4)
packages/audit       Append-only audit infrastructure
packages/i18n        Bilingual primitives                       (Phase 6)
packages/shared      Result types, shared utilities
tests/unit           Vitest unit tests
tests/integration    Workflow integration tests                 (Phase 4+)
tests/e2e            Playwright scenarios                       (Phase 7)
docs/architecture    System overview
docs/decisions       Architecture decision records (ADRs)
docs/workflows       Workflow documentation                     (Phase 4+)
```

## Hard boundaries (Spec §0)

No real Outlook / PropertyMe / Grow / OpenAI calls. No trust accounting, no lease
accounting, no portals, no native app. Everything runs on mock data until the
Foundation MVP Definition of Done (Spec §36) is met.

## Roadmap

| Phase | Scope | Gate |
|-------|-------|------|
| 0 | Monorepo, Next.js, Postgres, lint/test/build pipeline | 4 gates green |
| 1 | Domain model: 12 tables, migrations, seed, services | schema/relation tests |
| 2 | Mock connectors + realistic dataset | reset-reproducible env |
| 3 | AI Gateway: mock provider, Zod output, confidence, context builder | offline tests |
| 4 | Inbound-email workflow + approval state machine | maintenance integration test |
| 5 | Seven core screens | all operable |
| 6 | Bilingual UX | switch never breaks state |
| 7 | Three mandatory E2E scenarios | Playwright green |
| 8 | Hardening: errors, a11y, indexes, security review | DoD checklist |
