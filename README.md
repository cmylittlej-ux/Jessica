# REOS — Real Estate AI OS

Foundation MVP. A local-first, mock-data-driven AI work system for Melbourne real
estate sales & property management. See `docs/architecture/system-overview.md`.

> **Status: Phase 0–8 complete — Foundation MVP Definition of Done (Spec §36).**

## Prerequisites

- Node.js ≥ 22 (pnpm is provided via `corepack`, no manual install needed)
- Docker Desktop (for PostgreSQL) — install from <https://www.docker.com/products/docker-desktop/>
  and start it once before running database commands

## Quick start (one-time setup in ~2 minutes)

```bash
# 1. start the database (requires Docker Desktop)
pnpm db:up

# 2. install dependencies
corepack pnpm install

# 3. apply migrations and load the deterministic seed dataset
pnpm db:reset

# 4. run the web app
pnpm dev            # http://localhost:3000
```

Environment: copy `.env.example` to `.env.local` (never commit it — Spec §30).
The default connection string matches docker-compose:
`postgresql://reos:reos@localhost:5432/reos`.

### What you can do in the UI

- **AI Inbox** → "Simulate inbound email" injects a mock email and runs the full
  workflow: dedupe → sender/property match → AI classification → case link/create
  → bilingual summary → tasks → reply draft → approval.
- **Approvals** → review WHAT/WHY/PROPERTY/PERSON/RISK/PROPOSED CONTENT, then
  Approve & Execute / Edit-before-approving / Reject. Nothing executes without you.
- **中文 | EN** top-right switches the whole UI language; business data is untouched.
- **Inbox Detail** → compose a reply yourself in Chinese, preview the English
  sending version, approve & send (both versions are stored, Spec §25).
- **Case Detail / Property 360** → full history: communications, tasks, people,
  AI actions, activity timeline and the append-only audit trail.

Reset everything back to the deterministic seed at any time with `pnpm db:reset`.

## Quality gates (must all pass per Phase — Spec §35)

```bash
pnpm lint           # ESLint across all packages + web
pnpm typecheck      # tsc --noEmit in every package
pnpm test           # Vitest unit + integration (needs DATABASE_URL + Postgres up)
pnpm build          # Next.js production build
```

E2E (`pnpm exec playwright install chromium` once), then:

```bash
DATABASE_URL="postgresql://reos:reos@localhost:5432/reos" pnpm e2e
```

This runs the three mandatory scenarios (Spec §32–34): Maintenance full chain,
Sales Offer, Low-Confidence human fallback. The suite resets the database to the
seed first, so it is safe to run repeatedly.

## Definition of Done highlights (Spec §36)

- ✅ Local one-command startup; migrations + deterministic seed
- ✅ All seven screens operable (not static demos)
- ✅ Mock email injection → contact/property matching → case creation →
  structured AI classification → tasks/recommendations → bilingual reply →
  edit/approve/reject/mock send → timeline + audit log + AI feedback
- ✅ Low-confidence human fallback (no fabricated property/case relations)
- ✅ Maintenance / Sales Offer / Low Confidence E2E green; unit + integration +
  Playwright all green; TypeScript, lint, production build clean
- ✅ No real API dependency, no real customer data, no trust accounting
- ✅ Security review: see `docs/security-review.md`

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
docs/security-review.md  Phase 8 security checklist
```

## Hard boundaries (Spec §0)

No real Outlook / PropertyMe / Grow / OpenAI calls. No trust accounting, no lease
accounting, no portals, no native app. Everything runs on mock data until real
integrations are explicitly designed (see security review for what that requires).

## Roadmap

| Phase | Scope | Gate | Status |
|-------|-------|------|--------|
| 0 | Monorepo, Next.js, Postgres, lint/test/build pipeline | 4 gates green | ✅ |
| 1 | Domain model: 12 tables, migrations, seed, services | schema/relation tests | ✅ |
| 2 | Mock connectors + realistic dataset | reset-reproducible env | ✅ |
| 3 | AI Gateway: mock provider, Zod output, confidence, context builder | offline tests | ✅ |
| 4 | Inbound-email workflow + approval state machine | maintenance integration test | ✅ |
| 5 | Seven core screens | all operable | ✅ |
| 6 | Bilingual UX | switch never breaks state | ✅ |
| 7 | Three mandatory E2E scenarios | Playwright green | ✅ |
| 8 | Hardening: errors, a11y, responsive, indexes, security review | DoD checklist | ✅ |

## Performance notes (Phase 8)

- Every screen is server-rendered (`force-dynamic`) against a single pooled
  database client per process — no client-side data fetching waterfall.
- All list queries are LIMIT-bounded; hot paths are index-backed:
  `communications(received_at)`, `communications(case_id)`, `tasks(property_id)`,
  `tasks(assignee,user,status)`, `cases(property_id)`, `approvals(status)`,
  `activities(case_id/property_id)`, `audit_logs(entity,created_at)`.
- The inbox confidence badge uses one grouped aggregate instead of one query per
  row (N+1 fixed in Phase 8). First Load JS ≈ 118 kB across all routes.
