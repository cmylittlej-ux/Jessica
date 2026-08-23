import { eq, ilike, or } from 'drizzle-orm';
import { contacts, propertyContacts, type ReosDatabase } from '@reos/db';
import { ok, err, type Result } from '@reos/shared';
import { ConnectorError } from '../errors.ts';
import type { ConnectorContact, CRMConnector } from '../types.ts';

/**
 * MockCRMConnector (Spec §14) — stands in for a future GrowConnector.
 * One person may hold many roles; role views are derived from the
 * property_contacts join table, never by duplicating contacts (Spec §5.3).
 */

type ContactRow = typeof contacts.$inferSelect;

function toContact(row: Pick<
  ContactRow,
  | 'id'
  | 'agencyId'
  | 'firstName'
  | 'lastName'
  | 'displayName'
  | 'email'
  | 'phone'
  | 'preferredLanguage'
>): ConnectorContact {
  return {
    id: row.id,
    agencyId: row.agencyId,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: row.displayName,
    email: row.email,
    phone: row.phone,
    preferredLanguage: row.preferredLanguage,
  };
}

function persistence(scope: string, cause: unknown): ConnectorError {
  return new ConnectorError(
    'PERSISTENCE',
    `${scope} failed — see technical details`,
    cause instanceof Error ? { name: cause.name, message: cause.message } : String(cause),
  );
}

export function createMockCRMConnector(db: ReosDatabase): CRMConnector {
  return {
    async listByRole(role): Promise<Result<ConnectorContact[], ConnectorError>> {
      try {
        const rows = await db
          .selectDistinct({
            id: contacts.id,
            agencyId: contacts.agencyId,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            displayName: contacts.displayName,
            email: contacts.email,
            phone: contacts.phone,
            preferredLanguage: contacts.preferredLanguage,
          })
          .from(contacts)
          .innerJoin(propertyContacts, eq(propertyContacts.contactId, contacts.id))
          .where(eq(propertyContacts.role, role));
        return ok(rows.map(toContact));
      } catch (cause) {
        return err(persistence('crm listByRole', cause));
      }
    },

    async getById(id): Promise<Result<ConnectorContact | null, ConnectorError>> {
      try {
        const [row] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
        return ok(row ? toContact(row) : null);
      } catch (cause) {
        return err(persistence('crm getById', cause));
      }
    },

    async searchByName(query): Promise<Result<ConnectorContact[], ConnectorError>> {
      const trimmed = query.trim();
      if (!trimmed) return ok([]);
      try {
        const pattern = `%${trimmed}%`;
        const rows = await db
          .select()
          .from(contacts)
          .where(
            or(
              ilike(contacts.displayName, pattern),
              ilike(contacts.firstName, pattern),
              ilike(contacts.lastName, pattern),
            ),
          );
        return ok(rows.map(toContact));
      } catch (cause) {
        return err(persistence('crm searchByName', cause));
      }
    },
  };
}
