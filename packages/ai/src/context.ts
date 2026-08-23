import { and, count, desc, eq, ilike } from 'drizzle-orm';
import { contacts, communications, cases, properties, tasks, type ReosDatabase } from '@reos/db';
import { ok, err, type Result } from '@reos/shared';
import { AIError } from './errors.ts';
import type { CaseContext, ClassificationInput } from './schemas.ts';

/**
 * Context Builder (Spec §12 Token Efficiency Architecture).
 *
 * The AI never receives "everything" — only the output of deterministic
 * matches (exact email / exact address), the relevant case and a bounded
 * window of recent communications. These lookups are plain SQL: AI token
 * cost = 0.
 */

const EXCERPT_LENGTH = 280;

function excerpt(text: string): string {
  return text.length <= EXCERPT_LENGTH ? text : `${text.slice(0, EXCERPT_LENGTH)}…`;
}

export interface ContextMatcher {
  /** TIER_0: exact email match → contact. */
  findContactByEmail(email: string): Promise<Result<{ id: string; displayName: string; email: string | null } | null, AIError>>;
  /** TIER_0: exact street address match → property. */
  findPropertyByAddress(addressLine1: string): Promise<Result<{ id: string; addressLine1: string; suburb: string } | null, AIError>>;
  /** Assemble a minimal ClassificationInput around one inbound message. */
  buildClassificationInput(communicationId: string): Promise<Result<ClassificationInput & { caseId: string | null }, AIError>>;
  /** Assemble a compact CaseContext for summary / reply tasks. */
  buildCaseContext(caseId: string): Promise<Result<CaseContext, AIError>>;
}

export function createBuildContext(db: ReosDatabase): ContextMatcher {
  const fail = (scope: string, cause: unknown) =>
    err(
      new AIError(
        'PROVIDER_FAILURE',
        `context lookup failed (${scope})`,
        cause instanceof Error ? cause.message : String(cause),
      ),
    );

  return {
    async findContactByEmail(email) {
      try {
        const [row] = await db
          .select({ id: contacts.id, displayName: contacts.displayName, email: contacts.email })
          .from(contacts)
          .where(eq(contacts.email, email))
          .limit(1);
        return ok(row ?? null);
      } catch (cause) {
        return fail('contact by email', cause);
      }
    },

    async findPropertyByAddress(addressLine1) {
      try {
        const [row] = await db
          .select({
            id: properties.id,
            addressLine1: properties.addressLine1,
            suburb: properties.suburb,
          })
          .from(properties)
          .where(ilike(properties.addressLine1, addressLine1))
          .limit(1);
        return ok(row ?? null);
      } catch (cause) {
        return fail('property by address', cause);
      }
    },

    async buildClassificationInput(communicationId) {
      try {
        const [message] = await db
          .select()
          .from(communications)
          .where(eq(communications.id, communicationId))
          .limit(1);
        if (!message) {
          return err(new AIError('PROVIDER_FAILURE', `communication ${communicationId} not found`));
        }

        // Deterministic candidates only — never the full tables.
        let candidateContacts: ClassificationInput['candidateContacts'] = [];
        if (message.senderContactId) {
          const [sender] = await db
            .select({ id: contacts.id, displayName: contacts.displayName, email: contacts.email })
            .from(contacts)
            .where(eq(contacts.id, message.senderContactId))
            .limit(1);
          candidateContacts = sender ? [sender] : [];
        }

        let candidateProperties: ClassificationInput['candidateProperties'] = [];
        if (message.propertyId) {
          const [linked] = await db
            .select({
              id: properties.id,
              addressLine1: properties.addressLine1,
              suburb: properties.suburb,
            })
            .from(properties)
            .where(eq(properties.id, message.propertyId))
            .limit(1);
          candidateProperties = linked ? [linked] : [];
        }

        return ok({
          subject: message.subject ?? '',
          content: message.originalContent,
          language: message.originalLanguage,
          candidateProperties,
          candidateContacts,
          caseId: message.caseId,
        });
      } catch (cause) {
        return fail('classification context', cause);
      }
    },

    async buildCaseContext(caseId) {
      try {
        const [row] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
        if (!row) return err(new AIError('PROVIDER_FAILURE', `case ${caseId} not found`));

        // Bounded window: the 5 most recent communications, excerpted.
        const recent = await db
          .select({
            id: communications.id,
            direction: communications.direction,
            subject: communications.subject,
            content: communications.originalContent,
          })
          .from(communications)
          .where(eq(communications.caseId, caseId))
          .orderBy(desc(communications.createdAt))
          .limit(5);

        const [taskCount] = await db
          .select({ value: count() })
          .from(tasks)
          .where(and(eq(tasks.caseId, caseId), eq(tasks.status, 'OPEN')));

        return ok({
          caseId: row.id,
          title: row.title,
          businessDomain: row.businessDomain,
          caseType: row.caseType,
          status: row.status,
          priority: row.priority,
          recentCommunications: recent.map((c) => ({
            id: c.id,
            direction: c.direction,
            subject: c.subject,
            excerpt: excerpt(c.content),
          })),
          openTaskCount: taskCount?.value ?? 0,
        });
      } catch (cause) {
        return fail('case context', cause);
      }
    },
  };
}
