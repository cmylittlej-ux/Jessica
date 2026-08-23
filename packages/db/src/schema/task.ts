import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { cases } from './case.ts';
import {
  createdByTypeEnum,
  priorityEnum,
  taskSourceEnum,
  taskStatusEnum,
} from './enums.ts';
import { properties } from './property.ts';
import { users } from './agency.ts';

export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id').references(() => cases.id),
    propertyId: text('property_id').references(() => properties.id),
    assignedUserId: text('assigned_user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    description: text('description'),
    priority: priorityEnum('priority').notNull().default('NORMAL'),
    status: taskStatusEnum('status').notNull().default('OPEN'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    source: taskSourceEnum('source').notNull().default('HUMAN'),
    createdByType: createdByTypeEnum('created_by_type').notNull().default('USER'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('tasks_case_idx').on(t.caseId),
    index('tasks_assignee_status_idx').on(t.assignedUserId, t.status),
  ],
);

export const tasksRelations = relations(tasks, ({ one }) => ({
  case: one(cases, {
    fields: [tasks.caseId],
    references: [cases.id],
  }),
  property: one(properties, {
    fields: [tasks.propertyId],
    references: [properties.id],
  }),
  assignee: one(users, {
    fields: [tasks.assignedUserId],
    references: [users.id],
  }),
}));
