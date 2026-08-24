import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { cases } from './case.ts';
import {
  actionRequiredEnum,
  businessDomainEnum,
  caseTypeEnum,
  channelEnum,
  communicationStatusEnum,
  directionEnum,
  senderTypeEnum,
  sourceSystemEnum,
} from './enums.ts';
import { contacts } from './contact.ts';
import { properties } from './property.ts';
import { users } from './agency.ts';

/**
 * Unified communication (Spec §5.6) — not just email. Original content is
 * immutable; translations are stored side-by-side and never overwrite it
 * (Spec §2.7 Bilingual by Design).
 *
 * Foundation Final Hardening additions:
 * - §6 Party model: senderType/senderUserId/senderData replace the old
 *   "senderContactId doubles as outbound recipient" overloading. Outbound
 *   sends are USER-authored; inbound emails are CONTACT or EXTERNAL.
 * - §8 Source identity: every externally-sourced message carries its origin
 *   system + external message/conversation IDs with a uniqueness constraint
 *   so webhook/sync replays can never create duplicate rows.
 * - §11 Persisted classification: the four dimensions (business domain, case
 *   type, action required, workflow status via the linked case) plus who/when/
 *   how confident — queryable data, not UI-side guesses.
 */
export const communications = pgTable(
  'communications',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id').references(() => cases.id),
    propertyId: text('property_id').references(() => properties.id),
    direction: directionEnum('direction').notNull(),
    channel: channelEnum('channel').notNull(),

    // --- Party model (§6) ---------------------------------------------------
    senderType: senderTypeEnum('sender_type').notNull().default('CONTACT'),
    senderContactId: text('sender_contact_id').references(() => contacts.id),
    senderUserId: text('sender_user_id').references(() => users.id),
    /** Structured sender fallback, e.g. {email,name} for EXTERNAL senders. */
    senderData: jsonb('sender_data'),
    /** Structured recipients, e.g. {to:[...]},{cc:[...]} — schema-flexible. */
    recipientData: jsonb('recipient_data'),

    subject: text('subject'),
    originalContent: text('original_content').notNull(),
    originalLanguage: text('original_language').notNull().default('en'),
    translatedContentZh: text('translated_content_zh'),
    translatedContentEn: text('translated_content_en'),
    status: communicationStatusEnum('status').notNull().default('RECEIVED'),

    // --- Source identity (§8) -------------------------------------------------
    source: sourceSystemEnum('source').notNull().default('MANUAL'),
    sourceAccountId: text('source_account_id'),
    /** Legacy free-form external reference; prefer externalMessageId. */
    externalId: text('external_id'),
    externalMessageId: text('external_message_id'),
    externalConversationId: text('external_conversation_id'),
    sourceCreatedAt: timestamp('source_created_at', { withTimezone: true }),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),

    // --- Persisted classification (§11) ---------------------------------------
    businessDomain: businessDomainEnum('business_domain'),
    caseType: caseTypeEnum('case_type'),
    actionRequired: actionRequiredEnum('action_required'),
    classificationConfidence: real('classification_confidence'),
    classifiedAt: timestamp('classified_at', { withTimezone: true }),
    classificationSource: text('classification_source'),

    receivedAt: timestamp('received_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('communications_case_idx').on(t.caseId),
    index('communications_sender_idx').on(t.senderContactId),
    // Inbox list orders by received_at DESC; property 360 lists recent comms.
    index('communications_received_idx').on(t.receivedAt),
    index('communications_conversation_idx').on(t.externalConversationId),
    // §8 dedupe: one row per (system, mailbox, message). NULL keys never
    // collide in Postgres unique indexes, so manual/simulated rows are safe.
    uniqueIndex('communications_source_message_uidx').on(
      t.source,
      t.sourceAccountId,
      t.externalMessageId,
    ),
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
    senderUser: one(users, {
      fields: [communications.senderUserId],
      references: [users.id],
    }),
  }),
);
