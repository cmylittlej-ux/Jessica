import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import {
  businessDomainEnum,
  caseTypeEnum,
  priorityEnum,
  workflowStatusEnum,
} from './enums.ts';
import { agencies, users } from './agency.ts';
import { properties } from './property.ts';
import { maintenanceJobs } from './pm.ts';

/**
 * The system's core business object (Spec §2.2 Case First, §5.5).
 * Emails are merely Communications attached to a Case.
 *
 * §18: a Case may link to a source-owned MaintenanceJob — the job is the
 * PropertyMe fact object, the case is REOS's work-processing layer.
 */
export const cases = pgTable(
  'cases',
  {
    id: text('id').primaryKey(),
    agencyId: text('agency_id')
      .notNull()
      .references(() => agencies.id),
    propertyId: text('property_id').references(() => properties.id),
    maintenanceJobId: text('maintenance_job_id').references(() => maintenanceJobs.id),
    title: text('title').notNull(),
    businessDomain: businessDomainEnum('business_domain').notNull(),
    caseType: caseTypeEnum('case_type').notNull(),
    priority: priorityEnum('priority').notNull().default('NORMAL'),
    status: workflowStatusEnum('status').notNull().default('NEW'),
    summary: text('summary'),
    assignedUserId: text('assigned_user_id').references(() => users.id),
    openedAt: timestamp('opened_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('cases_agency_status_idx').on(t.agencyId, t.status),
    index('cases_property_idx').on(t.propertyId),
    index('cases_maintenance_job_idx').on(t.maintenanceJobId),
  ],
);

export const casesRelations = relations(cases, ({ one }) => ({
  agency: one(agencies, {
    fields: [cases.agencyId],
    references: [agencies.id],
  }),
  property: one(properties, {
    fields: [cases.propertyId],
    references: [properties.id],
  }),
  maintenanceJob: one(maintenanceJobs, {
    fields: [cases.maintenanceJobId],
    references: [maintenanceJobs.id],
  }),
  assignedUser: one(users, {
    fields: [cases.assignedUserId],
    references: [users.id],
  }),
}));
