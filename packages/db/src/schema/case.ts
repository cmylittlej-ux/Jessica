import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import {
  businessDomainEnum,
  caseTypeEnum,
  priorityEnum,
  workflowStatusEnum,
} from './enums';
import { agencies, users } from './agency';
import { properties } from './property';

/**
 * The system's core business object (Spec §2.2 Case First, §5.5).
 * Emails are merely Communications attached to a Case.
 */
export const cases = pgTable(
  'cases',
  {
    id: text('id').primaryKey(),
    agencyId: text('agency_id')
      .notNull()
      .references(() => agencies.id),
    propertyId: text('property_id').references(() => properties.id),
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
  assignedUser: one(users, {
    fields: [cases.assignedUserId],
    references: [users.id],
  }),
}));
