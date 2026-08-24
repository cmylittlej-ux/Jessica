# PropertyMe — Mapping Contract

> **Status: TEMPLATE — field-level rows are PENDING REAL API ACCESS (Gate 2.1).**
> Per Phase 2 Spec §6/§45: do not invent PropertyMe field names. Each row below
> is filled only from verified sample payloads, then locked by a regression
> fixture under `packages/connectors/propertyme/fixtures/`.

## Rules (already binding, independent of real payloads)

- Upsert identity: `source = 'PROPERTYME'` + `externalId` (+ `sourceAccountId`
  where applicable). Address / email / display name are NEVER durable identity.
- Every mirror row carries: `externalId`, `sourceUpdatedAt`, `lastSyncedAt`,
  `syncStatus`, and source lifecycle fields (`sourceStatus`, `sourceDeletedAt`).
- Source-owned fields may be overwritten by sync; REOS-owned fields
  (`summary`, local tags, Case links, Task state, workflow metadata) never are.
- No hard delete: a vanished source record is archived via lifecycle fields so
  Case/Communication/Task/Timeline/Audit history stays joinable.
- Same payload twice ⇒ zero duplicates, zero timeline noise, no data mutation
  unless the source hash/version changed (sync-health timestamps exempt).

## Field Mapping Table

### Property (P0)

| PropertyMe field | REOS field | Required? | Transform | Source-owned? | Notes |
|---|---|---|---|---|---|
| _pending real payload_ | properties.externalId | ✅ | verbatim | ✅ | upsert identity |
| _pending_ | properties.addressLine1..postcode | ? | verbatim | ✅ | |
| _pending_ | properties.status | ? | map to enum | ✅ | mapping table TBD |

### Contact / Owner / Tenant relationships (P0)

| PropertyMe field | REOS field | Required? | Transform | Source-owned? | Notes |
|---|---|---|---|---|---|
| _pending real payload_ | contacts.externalId | ✅ | verbatim | ✅ | |
| _pending_ | property_contacts role OWNER/TENANT | ✅ | relationship resolution | ✅ | validity window TBD |

### Tenancy (P0) / Lease (P0) / MaintenanceJob (P1) / Inspection (P1)

| PropertyMe field | REOS field | Required? | Transform | Source-owned? | Notes |
|---|---|---|---|---|---|
| _pending real payloads_ | tenancies.* / leases.* / maintenance_jobs.* / inspections.* | — | — | ✅ | rows filled at Gate 2.1 |

## Schema Gap Analysis

To be produced immediately after the first real payloads land: any REOS column
that cannot be populated, any source field with no REOS home, and the smallest
justified migration for each gap (Spec §45).
