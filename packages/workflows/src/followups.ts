import { and, eq, inArray, isNotNull, lte, ne } from 'drizzle-orm';
import {
  activities,
  cases,
  tasks,
  users,
  nextCaseStatus,
  type ReosDatabase,
} from '@reos/db';
import {
  BLOCKING_TASK_STATUSES,
  defaultFollowUpDueAt,
  statusOnCompletion,
  statusOnFollowUpDue,
} from '@reos/domain';

/** Resolve the assignee for auto-created wake-up tasks (admin preferred). */
async function findResponsibleUser(db: ReosDatabase): Promise<string> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'ADMIN'))
    .limit(1);
  if (admin) return admin.id;
  const [any] = await db.select({ id: users.id }).from(users).limit(1);
  if (!any) throw new Error('no users exist — run the seed first');
  return any.id;
}

/**
 * P0 Closure §1B — follow-up due progression.
 *
 * Advances every WAITING case whose open follow-up task has reached its
 * dueAt into FOLLOW_UP_DUE. There is deliberately no scheduler yet: the
 * future cron/worker simply calls this function on an interval.
 */
export async function processDueFollowUps(
  db: ReosDatabase,
  now: Date = new Date(),
): Promise<{ advancedCaseIds: string[] }> {
  // Open follow-up tasks that are due, on cases currently WAITING.
  const dueRows = await db
    .select({ caseId: tasks.caseId })
    .from(tasks)
    .innerJoin(cases, eq(cases.id, tasks.caseId))
    .where(
      and(
        eq(cases.status, 'WAITING'),
        inArray(tasks.status, ['OPEN']),
        isNotNull(tasks.dueAt),
        lte(tasks.dueAt, now),
      ),
    );

  const caseIds = [...new Set(dueRows.map((r) => r.caseId).filter((x): x is string => Boolean(x)))];
  for (const caseId of caseIds) {
    await db
      .update(cases)
      .set({ status: nextCaseStatus('WAITING', statusOnFollowUpDue('WAITING')), updatedAt: new Date() })
      .where(eq(cases.id, caseId));
  }
  return { advancedCaseIds: caseIds };
}

/**
 * P0 Closure §1C — complete a follow-up task and close the loop ONLY when no
 * other open (blocking) task remains on the case. A case with additional
 * required work stays exactly where it is.
 */
export async function completeFollowUpTask(
  db: ReosDatabase,
  taskId: string,
  now: Date = new Date(),
): Promise<{ taskDone: boolean; caseCompleted: boolean; remainingOpenTasks: number }> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task || task.status === 'DONE') {
    return { taskDone: false, caseCompleted: false, remainingOpenTasks: 0 };
  }

  await db
    .update(tasks)
    .set({ status: 'DONE', completedAt: now, updatedAt: now })
    .where(eq(tasks.id, taskId));

  if (!task.caseId) return { taskDone: true, caseCompleted: false, remainingOpenTasks: 0 };

  const [parent] = await db.select().from(cases).where(eq(cases.id, task.caseId)).limit(1);
  if (!parent) return { taskDone: true, caseCompleted: false, remainingOpenTasks: 0 };

  const closableFrom = statusOnCompletion(parent.status as Parameters<typeof statusOnCompletion>[0]);
  if (!closableFrom) return { taskDone: true, caseCompleted: false, remainingOpenTasks: -1 };

  const others = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.caseId, task.caseId),
        ne(tasks.id, taskId),
        inArray(tasks.status, [...BLOCKING_TASK_STATUSES]),
      ),
    );
  const remainingOpenTasks = others.length;

  if (remainingOpenTasks === 0) {
    await db
      .update(cases)
      .set({
        status: nextCaseStatus(parent.status as Parameters<typeof nextCaseStatus>[0], closableFrom),
        updatedAt: now,
      })
      .where(eq(cases.id, parent.id));
    await db.insert(activities).values({
      id: `actv_${crypto.randomUUID()}`,
      agencyId: parent.agencyId,
      propertyId: parent.propertyId,
      caseId: parent.id,
      actorType: 'USER',
      activityType: 'CASE_COMPLETED',
      title: 'Final follow-up completed — case closed',
      occurredAt: now,
    });
    return { taskDone: true, caseCompleted: true, remainingOpenTasks };
  }
  return { taskDone: true, caseCompleted: false, remainingOpenTasks };
}

/**
 * Phase 2 §A2 — WAITING wake-up invariant.
 *
 * A Case in WAITING must always have a future wake-up mechanism. This
 * idempotent helper creates exactly one follow-up task when the case is
 * WAITING and no blocking (OPEN / IN_PROGRESS / WAITING) task exists on it.
 * Calling it twice never duplicates the wake-up.
 */
export async function ensureCaseWakeUp(
  db: ReosDatabase,
  caseId: string,
  now: Date = new Date(),
): Promise<{ created: boolean; taskId: string | null; reason?: string }> {
  const [parent] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!parent) return { created: false, taskId: null, reason: 'CASE_NOT_FOUND' };
  if (parent.status !== 'WAITING') {
    return { created: false, taskId: null, reason: 'CASE_NOT_WAITING' };
  }

  const [active] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.caseId, caseId), inArray(tasks.status, [...BLOCKING_TASK_STATUSES])))
    .limit(1);
  if (active) return { created: false, taskId: active.id, reason: 'WAKE_UP_EXISTS' };

  const taskId = `tsk_${crypto.randomUUID()}`;
  await db.insert(tasks).values({
    id: taskId,
    caseId,
    assignedUserId: parent.assignedUserId ?? (await findResponsibleUser(db)),
    title: 'Wake-up: awaiting customer reply — follow up',
    description: 'Auto-created wake-up task (Phase 2 §A2): every WAITING case must have a future follow-up.',
    status: 'OPEN',
    source: 'WORKFLOW',
    dueAt: defaultFollowUpDueAt(now),
    createdAt: now,
    updatedAt: now,
  });
  return { created: true, taskId };
}
