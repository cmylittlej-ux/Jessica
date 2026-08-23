import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { cases } from './case';
import {
  aiActionStatusEnum,
  aiActionTypeEnum,
  approvalStatusEnum,
  feedbackTypeEnum,
} from './enums';
import { users } from './agency';

/**
 * Every AI action is recorded with its proposed payload before anything is
 * executed (Spec §5.9). External effects require an Approval row and the
 * state machine PROPOSED → APPROVED → EXECUTED / REJECTED (Spec §27).
 */
export const aiActions = pgTable(
  'ai_actions',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id').references(() => cases.id),
    actionType: aiActionTypeEnum('action_type').notNull(),
    provider: text('provider').notNull().default('mock'),
    model: text('model').notNull().default('mock-1'),
    inputSummary: text('input_summary'),
    proposedPayload: jsonb('proposed_payload').notNull(),
    finalPayload: jsonb('final_payload'),
    /** 0..1, validated by the confidence policy in Phase 3. */
    confidence: real('confidence'),
    status: aiActionStatusEnum('status').notNull().default('PROPOSED'),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('ai_actions_case_idx').on(t.caseId), index('ai_actions_status_idx').on(t.status)],
);

export const approvals = pgTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id').references(() => cases.id),
    actionId: text('action_id')
      .notNull()
      .references(() => aiActions.id),
    requestedUserId: text('requested_user_id')
      .notNull()
      .references(() => users.id),
    status: approvalStatusEnum('status').notNull().default('PENDING'),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by').references(() => users.id),
    decisionNote: text('decision_note'),
  },
  (t) => [index('approvals_status_idx').on(t.status)],
);

/**
 * Records how the human treated each AI output — the training signal for
 * future preference learning (Spec §5.10, §28).
 */
export const aiFeedbacks = pgTable(
  'ai_feedbacks',
  {
    id: text('id').primaryKey(),
    aiActionId: text('ai_action_id')
      .notNull()
      .references(() => aiActions.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    originalOutput: jsonb('original_output').notNull(),
    finalOutput: jsonb('final_output'),
    feedbackType: feedbackTypeEnum('feedback_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('ai_feedbacks_action_idx').on(t.aiActionId)],
);

export const aiActionsRelations = relations(aiActions, ({ one, many }) => ({
  case: one(cases, {
    fields: [aiActions.caseId],
    references: [cases.id],
  }),
  approvals: many(approvals),
  feedbacks: many(aiFeedbacks),
}));

export const approvalsRelations = relations(approvals, ({ one }) => ({
  action: one(aiActions, {
    fields: [approvals.actionId],
    references: [aiActions.id],
  }),
  requester: one(users, {
    fields: [approvals.requestedUserId],
    references: [users.id],
  }),
  reviewer: one(users, {
    fields: [approvals.reviewedBy],
    references: [users.id],
  }),
}));

export const aiFeedbacksRelations = relations(aiFeedbacks, ({ one }) => ({
  action: one(aiActions, {
    fields: [aiFeedbacks.aiActionId],
    references: [aiActions.id],
  }),
  user: one(users, {
    fields: [aiFeedbacks.userId],
    references: [users.id],
  }),
}));
