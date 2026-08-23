import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { cases } from './case';
import {
  channelEnum,
  communicationStatusEnum,
  directionEnum,
} from './enums';
import { contacts } from './contact';
import { properties } from './property';

/**
 * Unified communication (Spec §5.6) — not just email. Original content is
 * immutable; translations are stored side-by-side and never overwrite it
 * (Spec §2.7 Bilingual by Design).
 */
export const communications = pgTable(
  'communications',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id').references(() => cases.id),
    propertyId: text('property_id').references(() => properties.id),
    direction: directionEnum('direction').notNull(),
    channel: channelEnum('channel').notNull(),
    senderContactId: text('sender_contact_id').references(() => contacts.id),
    /** Structured recipients, e.g. [{to:[...]},{cc:[...]}] — schema-flexible. */
    recipientData: jsonb('recipient_data'),
    subject: text('subject'),
    originalContent: text('original_content').notNull(),
    originalLanguage: text('original_language').notNull().default('en'),
    translatedContentZh: text('translated_content_zh'),
    translatedContentEn: text('translated_content_en'),
    status: communicationStatusEnum('status').notNull().default('RECEIVED'),
    externalId: text('external_id'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('communications_case_idx').on(t.caseId),
    index('communications_sender_idx').on(t.senderContactId),
  ],
);

export const communicationsRelations = relations(
  communications,
  ({ one }) => ({
    case: one(cases, {
      fields: [communications.caseId],
      references: [cases.id],
    }),
    property: one(properties, {
      fields: [communications.propertyId],
      references: [properties.id],
    }),
    sender: one(contacts, {
      fields: [communications.senderContactId],
      references: [contacts.id],
    }),
  }),
);
