import { relations } from 'drizzle-orm';
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agencies } from './agency.ts';
import { contacts } from './contact.ts';
import { contactRoleEnum, propertySourceEnum, propertyStatusEnum, propertyTypeEnum } from './enums.ts';

export const properties = pgTable(
  'properties',
  {
    id: text('id').primaryKey(),
    agencyId: text('agency_id')
      .notNull()
      .references(() => agencies.id),
    addressLine1: text('address_line1').notNull(),
    addressLine2: text('address_line2'),
    suburb: text('suburb').notNull(),
    state: text('state').notNull().default('VIC'),
    postcode: text('postcode').notNull(),
    country: text('country').notNull().default('Australia'),
    propertyType: propertyTypeEnum('property_type').notNull(),
    status: propertyStatusEnum('status').notNull(),
    source: propertySourceEnum('source').notNull().default('MANUAL'),
    externalId: text('external_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('properties_agency_idx').on(t.agencyId),
    index('properties_suburb_idx').on(t.suburb),
  ],
);

/**
 * Property ↔ Contact relationship with role and validity window (Spec §5.4).
 * The same person may be BUYER today and OWNER after settlement — that is a
 * new row here, never a new contact.
 */
export const propertyContacts = pgTable(
  'property_contacts',
  {
    id: text('id').primaryKey(),
    propertyId: text('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    role: contactRoleEnum('role').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('property_contacts_uidx').on(t.propertyId, t.contactId, t.role),
    index('property_contacts_contact_idx').on(t.contactId),
  ],
);

export const propertiesRelations = relations(properties, ({ one, many }) => ({
  agency: one(agencies, {
    fields: [properties.agencyId],
    references: [agencies.id],
  }),
  contacts: many(propertyContacts),
}));

export const propertyContactsRelations = relations(
  propertyContacts,
  ({ one }) => ({
    property: one(properties, {
      fields: [propertyContacts.propertyId],
      references: [properties.id],
    }),
    contact: one(contacts, {
      fields: [propertyContacts.contactId],
      references: [contacts.id],
    }),
  }),
);
