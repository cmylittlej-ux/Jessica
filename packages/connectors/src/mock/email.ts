import { desc, eq } from 'drizzle-orm';
import { activities, auditLogs, communications, cases, type ReosDatabase } from '@reos/db';
import { ok, err, type Result } from '@reos/shared';
import { ConnectorError } from '../errors.ts';
import type {
  ConnectorMessage,
  EmailConnector,
  SendReceipt,
} from '../types.ts';

/**
 * MockEmailConnector (Spec §14). Backed by the system database — the same
 * store a future OutlookEmailConnector will sync into. `send` never touches
 * a real mail server but must, inside one transaction:
 *   1. record SENT status,
 *   2. produce an Activity,
 *   3. produce an AuditLog entry,
 *   4. save the final content verbatim.
 */

function toMessage(row: typeof communications.$inferSelect): ConnectorMessage {
  return {
    id: row.id,
    caseId: row.caseId,
    propertyId: row.propertyId,
    fromContactId: row.senderContactId,
    subject: row.subject,
    content: row.originalContent,
    language: row.originalLanguage,
    translatedContentZh: row.translatedContentZh,
    status: row.status,
    receivedAt: row.receivedAt ?? row.createdAt,
  };
}

function persistence(scope: string, cause: unknown): ConnectorError {
  return new ConnectorError(
    'PERSISTENCE',
    `${scope} failed — see technical details`,
    cause instanceof Error ? { name: cause.name, message: cause.message } : String(cause),
  );
}

export function createMockEmailConnector(db: ReosDatabase): EmailConnector {
  return {
    async listInbound(): Promise<Result<ConnectorMessage[], ConnectorError>> {
      try {
        const rows = await db
          .select()
          .from(communications)
          .where(eq(communications.direction, 'INBOUND'))
          .orderBy(desc(communications.receivedAt));
        return ok(rows.map(toMessage));
      } catch (cause) {
        return err(persistence('listInbound', cause));
      }
    },

    async getById(id): Promise<Result<ConnectorMessage | null, ConnectorError>> {
      try {
        const [row] = await db
          .select()
          .from(communications)
          .where(eq(communications.id, id))
          .limit(1);
        return ok(row ? toMessage(row) : null);
      } catch (cause) {
        return err(persistence('getById', cause));
      }
    },

    async send(input): Promise<Result<SendReceipt, ConnectorError>> {
      if (!input.content.trim()) {
        return err(new ConnectorError('VALIDATION', 'content must not be empty'));
      }

      // Resolve the owning agency: prefer the case's agency so Activity rows
      // always satisfy their NOT NULL constraint.
      let agencyId = input.agencyId;
      let propertyId = input.propertyId ?? null;
      if (input.caseId) {
        try {
          const [parentCase] = await db
            .select({ agencyId: cases.agencyId, propertyId: cases.propertyId })
            .from(cases)
            .where(eq(cases.id, input.caseId))
            .limit(1);
          if (!parentCase) {
            return err(new ConnectorError('NOT_FOUND', `case ${input.caseId} does not exist`));
          }
          agencyId = parentCase.agencyId;
          propertyId = propertyId ?? parentCase.propertyId;
        } catch (cause) {
          return err(persistence('send:resolve case', cause));
        }
      }
      if (!agencyId) {
        return err(
          new ConnectorError('VALIDATION', 'send requires caseId or an explicit agencyId'),
        );
      }

      const now = new Date();
      const id = `comm_${crypto.randomUUID()}`;

      try {
        await db.transaction(async (tx) => {
          // 1 + 4: SENT status and final content saved verbatim.
          await tx.insert(communications).values({
            id,
            caseId: input.caseId ?? null,
            propertyId,
            direction: 'OUTBOUND',
            channel: 'EMAIL',
            senderContactId: input.toContactId ?? null,
            recipientData: input.recipients ?? null,
            subject: input.subject,
            originalContent: input.content,
            originalLanguage: input.language ?? 'en',
            status: 'SENT',
            sentAt: now,
            createdAt: now,
          });

          // 2: human-readable timeline entry.
          await tx.insert(activities).values({
            id: `actv_${crypto.randomUUID()}`,
            agencyId,
            propertyId,
            caseId: input.caseId ?? null,
            actorType: 'SYSTEM',
            activityType: 'EMAIL_SENT',
            title: `Email sent: ${input.subject}`,
            metadata: { communicationId: id, channel: 'EMAIL', mock: true },
            occurredAt: now,
          });

          // 3: append-only audit trail.
          await tx.insert(auditLogs).values({
            id: `aud_${crypto.randomUUID()}`,
            actorType: 'SYSTEM',
            action: 'communication.send',
            entityType: 'Communication',
            entityId: id,
            afterData: {
              subject: input.subject,
              contentLength: input.content.length,
              status: 'SENT',
              mock: true,
            },
            metadata: { source: 'MockEmailConnector' },
            createdAt: now,
          });
        });
      } catch (cause) {
        return err(persistence('send', cause));
      }

      return ok({ communicationId: id, sentAt: now });
    },
  };
}
