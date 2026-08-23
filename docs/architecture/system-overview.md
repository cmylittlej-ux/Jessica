# REOS System Overview

Real Estate AI OS (REOS) — an independent AI work operating system for Melbourne real
estate sales and property management. Foundation MVP runs fully local, driven by mock
data, with zero real external API dependencies.

## Core business loop (acceptance chain)

```
Mock Email → Identify Sender → Match Contact → Match Property → Classify Domain/Case
→ Priority → Required Action → Create/Link Case → Create Task → AI Summary
→ Recommended Actions → Bilingual Reply → Approval → Human Approves/Edits
→ Mock Send → Update Task → Update Case → Activity Timeline → Audit Log → AI Feedback
```

## Architectural principles

| # | Principle | Meaning |
|---|-----------|---------|
| 1 | Domain First | Outlook / PropertyMe / Grow are future data sources (connectors) only |
| 2 | Case First | Email is one Communication inside a Case; never "one email = one task" |
| 3 | Connector Independent | Business layer only knows `EmailConnector` / `PropertyConnector` / `CRMConnector` abstractions |
| 4 | Model Independent | All AI via `AIGateway`; no `callOpenAI(...)` in business code |
| 5 | Human in the Loop | Every external action: PROPOSED → APPROVED → EXECUTED (or REJECTED) |
| 6 | Audit First | Append-only AuditLog for every AI/human mutation; UI can never edit it |
| 7 | Bilingual by Design | Original / Working / Sending language kept separate; original immutable |

## Layer map

```
apps/web            Next.js 15 App Router UI (7 core screens)
packages/domain     Property · Contact · Case · Communication · Task · Approval · Activity
packages/db         Drizzle schema · migrations · seed (PostgreSQL)
packages/connectors EmailConnector / PropertyConnector / CRMConnector + Mock impls
packages/ai         AIGateway · providers · Zod output schemas · Context Builder · tiers
packages/workflows  inbound-email pipeline · approval state machine
packages/audit      append-only audit infrastructure
packages/i18n       bilingual-by-design primitives
packages/shared     Result types and cross-cutting utilities
```

## Decision priority when in doubt (Spec §41)

Correctness → Data integrity → Auditability → Maintainability → Workflow speed →
AI intelligence → Visual polish.
