import { and, eq, ilike } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { properties, type ReosDatabase } from '@reos/db';
import { ok, err, type Result } from '@reos/shared';
import { ConnectorError } from '../errors.ts';
import type {
  ConnectorProperty,
  PropertyConnector,
  PropertyFilter,
} from '../types.ts';

/**
 * MockPropertyConnector (Spec §14) — stands in for a future
 * PropertyMeConnector. Reads the property portfolio from the system database.
 */

type PropertyRow = typeof properties.$inferSelect;

function toProperty(row: PropertyRow): ConnectorProperty {
  return {
    id: row.id,
    agencyId: row.agencyId,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    suburb: row.suburb,
    state: row.state,
    postcode: row.postcode,
    country: row.country,
    propertyType: row.propertyType,
    status: row.status,
    externalId: row.externalId,
  };
}

function persistence(scope: string, cause: unknown): ConnectorError {
  return new ConnectorError(
    'PERSISTENCE',
    `${scope} failed — see technical details`,
    cause instanceof Error ? { name: cause.name, message: cause.message } : String(cause),
  );
}

export function createMockPropertyConnector(db: ReosDatabase): PropertyConnector {
  return {
    async list(filter?: PropertyFilter): Promise<Result<ConnectorProperty[], ConnectorError>> {
      try {
        const conditions: SQL[] = [];
        if (filter?.agencyId) conditions.push(eq(properties.agencyId, filter.agencyId));
        if (filter?.status) conditions.push(eq(properties.status, filter.status));
        if (filter?.suburb) conditions.push(ilike(properties.suburb, filter.suburb));

        const rows = await db
          .select()
          .from(properties)
          .where(conditions.length > 0 ? and(...conditions) : undefined);
        return ok(rows.map(toProperty));
      } catch (cause) {
        return err(persistence('property list', cause));
      }
    },

    async getById(id): Promise<Result<ConnectorProperty | null, ConnectorError>> {
      try {
        const [row] = await db.select().from(properties).where(eq(properties.id, id)).limit(1);
        return ok(row ? toProperty(row) : null);
      } catch (cause) {
        return err(persistence('property getById', cause));
      }
    },
  };
}
