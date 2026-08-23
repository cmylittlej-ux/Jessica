import { and, desc, eq } from 'drizzle-orm';
import type { ReosDatabase } from './client.ts';
import {
  activities,
  agencies,
  aiActions,
  approvals,
  auditLogs,
  cases,
  communications,
  contacts,
  properties,
  tasks,
  users,
} from './schema/index.ts';

/**
 * Typed data-access layer (Phase 1). Business rules that span entities live
 * in services.ts; this layer is deliberately CRUD-shaped.
 *
 * NOTE: no update/delete methods are exposed for `auditLogs` — the table is
 * append-only by policy (Spec §5.12).
 */
export function createRepositories(db: ReosDatabase) {
  return {
    agencies: {
      async byId(id: string) {
        const [row] = await db.select().from(agencies).where(eq(agencies.id, id)).limit(1);
        return row ?? null;
      },
    },

    users: {
      async byEmail(email: string) {
        const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        return row ?? null;
      },
      async byId(id: string) {
        const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        return row ?? null;
      },
    },

    contacts: {
      async create(row: typeof contacts.$inferInsert) {
        const [created] = await db.insert(contacts).values(row).returning();
        return created;
      },
      async byEmail(email: string) {
        const [row] = await db
          .select()
          .from(contacts)
          .where(eq(contacts.email, email))
          .limit(1);
        return row ?? null;
      },
      async byId(id: string) {
        const [row] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
        return row ?? null;
      },
    },

    properties: {
      async create(row: typeof properties.$inferInsert) {
        const [created] = await db.insert(properties).values(row).returning();
        return created;
      },
      async byId(id: string) {
        const [row] = await db.select().from(properties).where(eq(properties.id, id)).limit(1);
        return row ?? null;
      },
      async listByAgency(agencyId: string) {
        return db.select().from(properties).where(eq(properties.agencyId, agencyId));
      },
    },

    cases: {
      async create(row: typeof cases.$inferInsert) {
        const [created] = await db.insert(cases).values(row).returning();
        return created;
      },
      async byId(id: string) {
        const [row] = await db.select().from(cases).where(eq(cases.id, id)).limit(1);
        return row ?? null;
      },
      async listOpenByAgency(agencyId: string) {
        return db
          .select()
          .from(cases)
          .where(and(eq(cases.agencyId, agencyId), eq(cases.status, 'IN_PROGRESS')))
          .orderBy(desc(cases.updatedAt));
      },
      async updateStatus(id: string, status: typeof cases.$inferSelect['status']) {
        const [updated] = await db
          .update(cases)
          .set({
            status,
            updatedAt: new Date(),
            closedAt: status === 'COMPLETED' ? new Date() : null,
          })
          .where(eq(cases.id, id))
          .returning();
        return updated;
      },
    },

    communications: {
      async create(row: typeof communications.$inferInsert) {
        const [created] = await db.insert(communications).values(row).returning();
        return created;
      },
      async listByCase(caseId: string) {
        return db
          .select()
          .from(communications)
          .where(eq(communications.caseId, caseId))
          .orderBy(desc(communications.createdAt));
      },
    },

    tasks: {
      async create(row: typeof tasks.$inferInsert) {
        const [created] = await db.insert(tasks).values(row).returning();
        return created;
      },
      async listByAssignee(userId: string) {
        return db
          .select()
          .from(tasks)
          .where(eq(tasks.assignedUserId, userId))
          .orderBy(desc(tasks.createdAt));
      },
      async updateStatus(id: string, status: typeof tasks.$inferSelect['status']) {
        const [updated] = await db
          .update(tasks)
          .set({
            status,
            updatedAt: new Date(),
            completedAt: status === 'DONE' ? new Date() : null,
          })
          .where(eq(tasks.id, id))
          .returning();
        return updated;
      },
    },

    aiActions: {
      async create(row: typeof aiActions.$inferInsert) {
        const [created] = await db.insert(aiActions).values(row).returning();
        return created;
      },
      async byId(id: string) {
        const [row] = await db.select().from(aiActions).where(eq(aiActions.id, id)).limit(1);
        return row ?? null;
      },
      async updateStatus(id: string, status: typeof aiActions.$inferSelect['status']) {
        const [updated] = await db
          .update(aiActions)
          .set({ status, executedAt: status === 'EXECUTED' ? new Date() : null })
          .where(eq(aiActions.id, id))
          .returning();
        return updated;
      },
    },

    approvals: {
      async create(row: typeof approvals.$inferInsert) {
        const [created] = await db.insert(approvals).values(row).returning();
        return created;
      },
      async pending() {
        return db.select().from(approvals).where(eq(approvals.status, 'PENDING'));
      },
      async update(
        id: string,
        patch: Partial<typeof approvals.$inferInsert> &
          Pick<typeof approvals.$inferInsert, 'status'>,
      ) {
        const [updated] = await db
          .update(approvals)
          .set(patch)
          .where(eq(approvals.id, id))
          .returning();
        return updated;
      },
    },

    activities: {
      async append(row: typeof activities.$inferInsert) {
        const [created] = await db.insert(activities).values(row).returning();
        return created;
      },
      async listByCase(caseId: string) {
        return db
          .select()
          .from(activities)
          .where(eq(activities.caseId, caseId))
          .orderBy(desc(activities.occurredAt));
      },
    },

    /** Append-only: insert + read only, by design (Spec §2.6 / §5.12). */
    auditLogs: {
      async append(row: typeof auditLogs.$inferInsert) {
        const [created] = await db.insert(auditLogs).values(row).returning();
        return created;
      },
      async listByEntity(entityType: string, entityId: string) {
        return db
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
          .orderBy(desc(auditLogs.createdAt));
      },
    },
  };
}

export type ReosRepositories = ReturnType<typeof createRepositories>;
