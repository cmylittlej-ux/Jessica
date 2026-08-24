import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  numeric,
  pgTable,
  pgEnum,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agencies } from './agency.ts';
import { contacts } from './contact.ts';
import {
  executionStatusEnum,
  priorityEnum,
  propertySourceEnum,
  sourceSystemEnum,
  syncStatusEnum,
} from './enums.ts';
import { aiActions } from './approval.ts';
import { properties } from './property.ts';

/**
 * PropertyMe-ready data foundation (Spec §18–§25).
 *
 * These entities are MIRRORS of source-of-truth business objects owned by
 * PropertyMe (PM) / Grow. REOS never mutates their canonical fields — it only
 * stores a synced copy plus its own operational metadata (§22). Deletions from
 * the source are soft (sourceStatus/sourceDeletedAt), because historical
 * cases/emails/audits must stay joinable forever (§21).
 *
 * MaintenanceJob ≠ Case (§18): the job is the PM fact ("hot water unit,
 * ABC Plumbing, $480 quote, awaiting owner approval"); the Case is REOS's
 * work-processing layer (emails, tasks, approvals) that links to it.
 */

// --- Shared enums -------------------------------------------------------------

export const tenancyStatusEnum = pgEnum('tenancy_status', [
  'FUTURE',
  'CURRENT',
  'NOTICE_GIVEN',
  'ENDED',
]);

export const leaseStatusEnum = pgEnum('lease_status', [
  'DRAFT',
  'ACTIVE',
  'EXPIRING_SOON',
  'EXPIRED',
  'TERMINATED',
  'RENEWED',
]);

export const maintenanceJobStatusEnum = pgEnum('maintenance_job_status', [
  'LOGGED',
  'QUOTE_PENDING',
  'AWAITING_OWNER_APPROVAL',
  'APPROVED',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);

export const inspectionTypeEnum = pgEnum('inspection_type', [
  'ROUTINE',
  'ENTRY',
  'EXIT',
  'OPEN_HOME',
]);

export const inspectionStatusEnum = pgEnum('inspection_status', [
  'SCHEDULED',
  'COMPLETED',
  'CANCELLED',
]);

/** Columns every source-owned mirror entity carries (§24). */
const syncColumns = {
  source: propertySourceEnum('source').notNull().default('MANUAL'),
  externalId: text('external_id'),
  /** §24: lifecycle mirror of the source record — archived, not deleted (§21). */
  sourceStatus: text('source_status').notNull().default('ACTIVE'),
  sourceDeletedAt: timestamp('source_deleted_at', { withTimezone: true }),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  sourceHash: text('source_hash'),
  syncStatus: syncStatusEnum('sync_status').notNull().default('PENDING'),
  syncError: text('sync_error'),
};

// --- Tenancy -------------------------------------------------------------------

/**
 * Who lives at a property during which period (§23): the same tenant can hold
 * multiple historical tenancies for the same property — history is rows here,
 * never an overwrite of the property_contacts link.
 */
export const tenancies = pgTable(
  'tenancies',
  {
    id: text('id').primaryKey(),
    agencyId: text('agency_id')
      .notNull()
      .references(() => agencies.id),
    propertyId: text('property_id')
      .notNull()
      .references(() => properties.id),
    tenantContactId: text('tenant_contact_id')
      .notNull()
      .references(() => contacts.id),
    status: tenancyStatusEnum('status').notNull().default('CURRENT'),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }),
    rentAmount: numeric('rent_amount', { precision: 12, scale: 2 }),
    rentFrequency: text('rent_frequency').notNull().default('WEEKLY'),
    bondAmount: numeric('bond_amount', { precision: 12, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...syncColumns,
  },
  (t) => [
    index('tenancies_property_idx').on(t.propertyId),
    index('tenancies_tenant_idx').on(t.tenantContactId),
    uniqueIndex('tenancies_source_uidx').on(t.source, t.externalId),
  ],
);

// --- Lease -----------------------------------------------------------------------

/**
 * The legal lease object (§19). A "Lease Renewal" CASE discusses this entity;
 * the case is never mistaken for the lease itself.
 */
export const leases = pgTable(
  'leases',
  {
    id: text('id').primaryKey(),
    agencyId: text('agency_id')
      .notNull()
      .references(() => agencies.id),
    propertyId: text('property_id')
      .notNull()
      .references(() => properties.id),
    primaryTenantContactId: text('primary_tenant_contact_id').references(() => contacts.id),
    status: leaseStatusEnum('status').notNull().default('ACTIVE'),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }),
    rentAmount: numeric('rent_amount', { precision: 12, scale: 2 }),
    rentFrequency: text('rent_frequency').notNull().default('MONTHLY'),
    bondAmount: numeric('bond_amount', { precision: 12, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...syncColumns,
  },
  (t) => [
    index('leases_property_idx').on(t.propertyId),
    uniqueIndex('leases_source_uidx').on(t.source, t.externalId),
  ],
);

// --- MaintenanceJob ---------------------------------------------------------------

export const maintenanceJobs = pgTable(
  'maintenance_jobs',
  {
    id: text('id').primaryKey(),
    agencyId: text('agency_id')
      .notNull()
      .references(() => agencies.id),
    propertyId: text('property_id')
      .notNull()
      .references(() => properties.id),
    title: text('title').notNull(),
    issue: text('issue'),
    status: maintenanceJobStatusEnum('status').notNull().default('LOGGED'),
    priority: priorityEnum('priority').notNull().default('NORMAL'),
    tradeName: text('trade_name'),
    quoteAmount: numeric('quote_amount', { precision: 12, scale: 2 }),
    loggedAt: timestamp('logged_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...syncColumns,
  },
  (t) => [
    index('maintenance_jobs_property_idx').on(t.propertyId),
    index('maintenance_jobs_status_idx').on(t.status),
    uniqueIndex('maintenance_jobs_source_uidx').on(t.source, t.externalId),
  ],
);

// --- Inspection ----------------------------------------------------------------------

export const inspections = pgTable(
  'inspections',
  {
    id: text('id').primaryKey(),
    agencyId: text('agency_id')
      .notNull()
      .references(() => agencies.id),
    propertyId: text('property_id')
      .notNull()
      .references(() => properties.id),
    type: inspectionTypeEnum('type').notNull().default('ROUTINE'),
    status: inspectionStatusEnum('status').notNull().default('SCHEDULED'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...syncColumns,
  },
  (t) => [
    index('inspections_property_idx').on(t.propertyId),
    uniqueIndex('inspections_source_uidx').on(t.source, t.externalId),
  ],
);

// --- ExternalEntityMapping (§20) ---------------------------------------------------

/**
 * One canonical bridge between external IDs and local rows. A PropertyMe id
 * must always resolve back to REOS without relying on addresses or emails as
 * identity.
 */
export const externalEntityMappings = pgTable(
  'external_entity_mappings',
  {
    id: text('id').primaryKey(),
    source: sourceSystemEnum('source').notNull(),
    sourceAccountId: text('source_account_id'),
    externalEntityType: text('external_entity_type').notNull(),
    externalId: text('external_id').notNull(),
    localEntityType: text('local_entity_type').notNull(),
    localEntityId: text('local_entity_id').notNull(),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    sourceHash: text('source_hash'),
    syncStatus: syncStatusEnum('sync_status').notNull().default('SYNCED'),
    syncError: text('sync_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('external_mappings_uidx').on(
      t.source,
      t.externalEntityType,
      t.externalId,
    ),
    index('external_mappings_local_idx').on(t.localEntityType, t.localEntityId),
  ],
);

// --- ActionExecution / Outbox (§15) --------------------------------------------------

/**
 * Outbox row created BEFORE any external side effect. `executionKey` is
 * globally unique — replaying the same key returns the existing execution and
 * must never re-send (duplicate-email guard).
 */
export const actionExecutions = pgTable(
  'action_executions',
  {
    id: text('id').primaryKey(),
    actionId: text('action_id')
      .notNull()
      .references(() => aiActions.id),
    executionKey: text('execution_key').notNull(),
    status: executionStatusEnum('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    /** Connector-specific result reference (e.g. Outlook message id). */
    externalRef: text('external_ref'),
    connector: text('connector').notNull().default('mock-email'),
    correlationId: text('correlation_id'),
    lastError: text('last_error'),
    /** P0 Closure §3: when the EXECUTING lock was taken — stale-lock recovery key. */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    executedAt: timestamp('executed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('action_executions_key_uidx').on(t.executionKey),
    index('action_executions_action_idx').on(t.actionId),
  ],
);

// --- Relations ------------------------------------------------------------------------

export const tenanciesRelations = relations(tenancies, ({ one }) => ({
  property: one(properties, {
    fields: [tenancies.propertyId],
    references: [properties.id],
  }),
  tenant: one(contacts, {
    fields: [tenancies.tenantContactId],
    references: [contacts.id],
  }),
}));

export const leasesRelations = relations(leases, ({ one }) => ({
  property: one(properties, {
    fields: [leases.propertyId],
    references: [properties.id],
  }),
}));

export const maintenanceJobsRelations = relations(maintenanceJobs, ({ one }) => ({
  property: one(properties, {
    fields: [maintenanceJobs.propertyId],
    references: [properties.id],
  }),
}));

export const inspectionsRelations = relations(inspections, ({ one }) => ({
  property: one(properties, {
    fields: [inspections.propertyId],
    references: [properties.id],
  }),
}));

export const actionExecutionsRelations = relations(actionExecutions, ({ one }) => ({
  action: one(aiActions, {
    fields: [actionExecutions.actionId],
    references: [aiActions.id],
  }),
}));
