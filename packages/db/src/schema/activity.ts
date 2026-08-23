import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { agencies } from './agency';
import { actorTypeEnum } from './enums';
import { cases } from './case';
import { properties } from './property';

/**
 * Unified human-readable timeline (Spec §5.11).
 */
export const activities = pgTable(
  'activities',
  {
    id: text('id').primaryKey(),
    agencyId: text('agency_id')
      .notNull()
      .references(() => agencies.id),
    propertyId: text('property_id').references(() => properties.id),
    caseId: text('case_id').references(() => cases.id),
    actorType: actorTypeEnum('actor_type').notNull(),
    /** users.id / aiActions.id / external identifier — polymorphic. */
    actorId: text('actor_id'),
    activityType: text('activity_type').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    metadata: jsonb('metadata'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('activities_case_idx').on(t.caseId),
    index('activities_property_idx').on(t.propertyId),
  ],
);

/**
 * System behaviour audit — append-only by policy (Spec §5.12). The repository
 * layer exposes no update or delete operations for this table, and the UI is
 * forbidden from editing it. Answers forever: who did what, when, to what,
 * with which before/after state.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    beforeData: jsonb('before_data'),
    afterData: jsonb('after_data'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_created_idx').on(t.createdAt),
  ],
);

export const activitiesRelations = relations(activities, ({ one }) => ({
  agency: one(agencies, {
    fields: [activities.agencyId],
    references: [agencies.id],
  }),
  case: one(cases, {
    fields: [activities.caseId],
    references: [cases.id],
  }),
  property: one(properties, {
    fields: [activities.propertyId],
    references: [properties.id],
  }),
}));
