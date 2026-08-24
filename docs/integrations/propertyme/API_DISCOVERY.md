# PropertyMe — API Discovery

> **Status: PENDING REAL API ACCESS (Gate 2.1)**
>
> Per Phase 2 Spec §6: endpoint contracts and field names must NEVER be
> inferred from public marketing pages. This document is completed only after
> real credentials + official API documentation + sample payloads are obtained.

## Checklist (fill each only from verified sources)

| Item | Status | Evidence source |
|---|---|---|
| Authentication model | ❌ pending | official docs / sandbox |
| Available resources (Property/Contact/Tenancy/Lease/MaintenanceJob/Inspection) | ❌ pending | official docs |
| Pagination behavior | ❌ pending | sample payloads |
| Rate limits (if documented) | ❌ pending | official docs |
| Updated-since / incremental capability | ❌ pending | official docs |
| Archive / deletion semantics | ❌ pending | official docs |
| External ID format & stability | ❌ pending | sample payloads |
| Timestamp semantics (UTC? local?) | ❌ pending | sample payloads |
| Error model | ❌ pending | official docs |
| Read permissions on Manage PM plan | ❌ pending | account verification |

## Sample Payloads

Sanitized fixtures will be stored under `packages/connectors/propertyme/fixtures/`
once real payloads are captured. No fixtures exist yet — placeholder shapes are
deliberately NOT committed (Spec §6/§14).

## Blockers to resolve before Gate 2.1 completes

1. PropertyMe Manage PM API access enabled for the target agency account.
2. Official API documentation or OpenAPI spec.
3. At least one authenticated read call per P0 resource with a captured payload.

Until all three are done, the PropertyMe connector remains at the boundary
definition level (`packages/connectors/src/types.ts`) plus the existing mock —
no `propertyme/` client code is written against guessed contracts.
