/**
 * AuditService (Spec Hardening §30).
 *
 * Single funnel for audit writes so metadata stays consistent: actor, source,
 * correlationId, entity refs. Append-only — callers can never update or
 * delete through this interface. Existing direct db.insert(auditLogs) call
 * sites migrate here gradually.
 */
import { auditLogs, type ReosDatabase } from '@reos/db';

export type AuditActorType = 'USER' | 'AI' | 'SYSTEM' | 'EXTERNAL';

/** Accepts either the root db client or a transaction client (§14). */
export type AuditDb = ReosDatabase | Parameters<Parameters<ReosDatabase['transaction']>[0]>[0];

export interface AuditEntry {
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  caseId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  /** Workflow correlation id — same corr_… across the whole chain (§31). */
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

export function newAuditId(): string {
  return `aud_${crypto.randomUUID()}`;
}

/**
 * Write one append-only audit row inside an optional transaction client
 * (`db` may be a tx). Never throws into the caller's business path unless the
 * caller is itself the audit writer for a failure path — auditing failures
 * should be surfaced, not swallowed silently in workflows.
 */
export async function recordAudit(
  db: AuditDb,
  entry: AuditEntry,
): Promise<void> {
  await db.insert(auditLogs).values({
    id: newAuditId(),
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    beforeData: (entry.beforeData as never) ?? null,
    afterData: (entry.afterData as never) ?? null,
    metadata: {
      ...(entry.correlationId ? { correlationId: entry.correlationId } : {}),
      ...(entry.caseId ? { caseId: entry.caseId } : {}),
      ...(entry.metadata ?? {}),
    },
    createdAt: new Date(),
  });
}

export const PACKAGE_NAME = '@reos/audit';
