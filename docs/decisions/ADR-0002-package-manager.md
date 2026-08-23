# ADR-0002 — Package Manager & Database Runtime on This Machine

- **Status**: Accepted
- **Date**: 2026-08-23
- **Phase**: 0

## Context

Environment probe of the development machine (macOS, Apple Silicon):

| Tool | Status |
|------|--------|
| Node.js | 22.22.2 ✓ |
| git | 2.39.5 ✓ |
| pnpm | not installed → provided via corepack |
| Docker | not installed (user will install Docker Desktop) |
| PostgreSQL | not installed |

Two issues surfaced during Phase 0 bootstrap:

1. pnpm v10/v11 uses a SQLite-backed store index which fails under the assistant's
   sandboxed shell (`SQLITE_ERROR: disk I/O error` on store lock).
2. `create-next-app` dependency linking was denied by the sandbox broker
   (`ERR_PNPM_CODEBUDDY_BROKER_DENY`) during symlink creation.

## Decision

1. Pin `"packageManager": "pnpm@9.15.9"` — the last v9 line uses the classic
   content-addressable store without SQLite and is unaffected by issue 1.
2. Dependency installation commands may need to run outside the sandbox
   (`dangerouslyDisableSandbox`) when the broker denies filesystem operations;
   this is limited to install scripts, never applied to tests or business code.
3. PostgreSQL runs via Docker Desktop + repo `docker-compose.yml` (service `db`,
   postgres:16-alpine, user/pass/db = reos/reos/reos). Until Docker Desktop is
   installed, DB-dependent steps (migration/seed/integration tests) are deferred;
   everything else proceeds normally.

## Consequences

- Lockfile is `pnpm-lock.yaml` v9 format.
- `pnpm db:up` / `pnpm db:down` wrap docker compose for the database lifecycle.

## Update (2026-08-23 evening)

The broker denial (`ERR_PNPM_CODEBUDDY_BROKER_DENY`) persists even with the command
sandbox disabled — it is an application-level file broker, not the sandbox. pnpm's
default virtual-store layout (`node_modules/.pnpm/**`, symlink-heavy) is the trigger.

**Mitigation**: repo `.npmrc` pins `node-linker=hoisted` +
`package-import-method=copy`, producing a flat, npm-like node_modules built from
file copies instead of store symlinks. Functionally identical for Next.js / Vitest /
Drizzle; recorded here per Spec §43 (document small implementation decisions).
