import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { agencies } from './agency';

/**
 * Unified contact (Spec §5.3). Never create separate Owner/Buyer/Tenant
 * islands — one person, many roles via the property_contacts join table.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    agencyId: text('agency_id')
      .notNull()
      .references(() => agencies.id),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    preferredLanguage: text('preferred_language').notNull().default('en'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('contacts_agency_idx').on(t.agencyId),
    index('contacts_email_idx').on(t.email),
  ],
);

export const contactsRelations = relations(contacts, ({ one }) => ({
  agency: one(agencies, {
    fields: [contacts.agencyId],
    references: [agencies.id],
  }),
}));
