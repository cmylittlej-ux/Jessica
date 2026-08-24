# Security Review — Foundation MVP (Spec §30 / Phase 8)

Scope: the whole `reos` monorepo as of Phase 8. This is a **local-only, mock-data**
system; the review below records what was checked and what is deliberately out
of scope until real integrations exist.

## Checked

| Area | Status | Notes |
|---|---|---|
| Secrets in repo | ✅ Clean | No API keys/tokens anywhere; `.env.example` only documents `DATABASE_URL`. Spec §30: never commit `.env.local`. |
| Real external calls | ✅ None | All connectors/AI providers are deterministic mocks (ADR-0001). No Outlook / PropertyMe / Grow / LLM network calls — nothing can leak data out. |
| SQL injection | ✅ Safe | All queries go through Drizzle's parameterised query builder; no string-concatenated SQL in app code. |
| Input validation | ✅ | Every server action reads typed fields and early-returns on empty/invalid values; AI outputs re-validated with Zod inside the gateway (trust-but-verify). |
| Authorization model | ⚠️ MVP simplification | Single implicit user (`firstUserId()`); all seeded users belong to one agency. Fine for local demo; a real deployment needs session auth + per-agency row scoping before anything else. |
| Audit integrity | ✅ | `audit_logs` has no update/delete path in code; UI renders it read-only. |
| Human-in-the-loop | ✅ | External effects only via PROPOSED → APPROVED → EXECUTED; rejection never executes; low-confidence results cannot create relations or approvals. |
| XSS | ✅ | React escapes all rendered strings by default; no `dangerouslySetInnerHTML` in the codebase. |
| Cookies | ✅ Minimal | The only cookie is the non-sensitive `reos_lang` UI preference. |
| CSRF | ⚠️ Accepted risk | Server Actions are POST-only with Next's built-in origin checks; the app binds to localhost for local use. |
| Dependency surface | ✅ Small | Runtime deps: Next/React/Tailwind/Drizzle/pg/Zod + workspace packages. Run `pnpm audit` periodically. |
| Logs & PII | ✅ | Mock data only (Spec §31: future real customer data must never reach application logs). |

## Explicit non-goals (until post-MVP)

- Authentication / sessions / multi-tenancy
- Rate limiting, WAF, TLS — meaningless for localhost
- Trust accounting data protections (out of scope per hard boundaries)

## Re-run checklist

When real integrations begin, redo this review and add at minimum:
session-based auth, per-agency authorization on every query, secret management,
outbound call allow-listing, structured redacted logging.
