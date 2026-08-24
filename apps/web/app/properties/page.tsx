import Link from "next/link";
import { sql } from "drizzle-orm";
import { cases, properties, propertyContacts } from "@reos/db";
import { getDb } from "../_lib/db";
import { getI18n, fmt } from "../_lib/i18n";
import { EmptyHint, PageHeader, StatusBadge } from "../_components/ui";

export const dynamic = "force-dynamic";

/** Screen 7a — Properties list with open-case counts. */
export default async function PropertiesPage() {
  const { t } = await getI18n();
  const db = getDb();

  const rows = await db
    .select({
      id: properties.id,
      address: properties.addressLine1,
      suburb: properties.suburb,
      postcode: properties.postcode,
      propertyType: properties.propertyType,
      status: properties.status,
      source: properties.source,
      openCases: sql<number>`(
        select count(*)::int from ${cases}
        where ${cases.propertyId} = ${properties.id} and ${cases.closedAt} is null
      )`,
      contactCount: sql<number>`(
        select count(*)::int from ${propertyContacts}
        where ${propertyContacts.propertyId} = ${properties.id} and ${propertyContacts.validTo} is null
      )`,
    })
    .from(properties)
    .orderBy(properties.suburb, properties.addressLine1)
    .limit(200);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader title={t["props.title"]} subtitle={t["props.subtitle"]} />

      {rows.length === 0 ? (
        <EmptyHint>{t["props.empty"]}</EmptyHint>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {rows.map((p) => (
            <Link
              key={p.id}
              href={`/properties/${p.id}`}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-300"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.address}</span>
                <span className="text-xs text-neutral-500">{p.suburb} {p.postcode}</span>
                <span className="ml-auto"><StatusBadge status={p.status} /></span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5">{p.propertyType}</span>
                <span className="rounded bg-neutral-100 px-1.5 py-0.5">{fmt(t["props.contactsCount"], { n: p.contactCount })}</span>
                {p.openCases > 0 && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">
                    {fmt(t["props.openCases"], { n: p.openCases })}
                  </span>
                )}
                <span className="ml-auto uppercase text-neutral-400">{p.source}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
