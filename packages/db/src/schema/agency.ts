import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { userRoleEnum } from './enums';

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const agencies = pgTable('agencies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** IANA name; Spec §5.1 default Australia/Melbourne. */
  timezone: text('timezone').notNull().default('Australia/Melbourne'),
  defaultLanguage: text('default_language').notNull().default('zh'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    agencyId: text('agency_id')
      .notNull()
      .references(() => agencies.id),
    name: text('name').notNull(),
    email: text('email').notNull(),
    workingLanguage: text('working_language').notNull().default('zh'),
    role: userRoleEnum('role').notNull(),
    /**
     * AI autonomy level for this user (Spec §10 / §13). Free-form until the
     * confidence policy lands in Phase 3; values like 'STANDARD'.
     */
    aiAutonomyLevel: text('ai_autonomy_level').notNull().default('STANDARD'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('users_agency_idx').on(t.agencyId),
    uniqueIndex('users_email_uidx').on(t.email),
  ],
);

export const agenciesRelations = relations(agencies, ({ many }) => ({
  users: many(users),
}));

export const usersRelations = relations(users, ({ one }) => ({
  agency: one(agencies, {
    fields: [users.agencyId],
    references: [agencies.id],
  }),
}));
