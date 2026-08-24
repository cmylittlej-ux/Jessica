import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  activities,
  cases,
  communications,
  contacts,
  properties,
  propertyContacts,
  tasks,
} from "@reos/db";
import { getDb } from "../../_lib/db";
import { getI18n, fmt } from "../../_lib/i18n";
import { completeTaskAction } from "../../actions";
import {
  EmptyHint,
  PageHeader,
  PriorityBadge,
  SectionTitle,
  StatusBadge,
  formatDateTime,
} from "../../_components/ui";

export const dynamic = "force-dynamic";

/**
 * Screen 7b — Property 360. One screen answering "what is happening at this
 * address": people by role, open cases, tasks, recent communications and the
 * unified activity timeline. Simulated data (rent etc.) is clearly labelled.
 */
export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { t } = await getI18n();
  const db = getDb();

  const [property] = await db.select().from(properties).where(eq(properties.id, id)).limit(1);
  if (!property) notFound();

  const [people, openCases, propTasks, recentComms, timeline] = await Promise.all([
    db
      .select({ pc: propertyContacts, contact: contacts })
      .from(propertyContacts)
      .innerJoin(contacts, eq(contacts.id, propertyContacts.contactId))
      .where(and(eq(propertyContacts.propertyId, id), isNull(propertyContacts.validTo)))
      .limit(40),
    db
      .select()
      .from(cases)
      .where(and(eq(cases.propertyId, id), isNull(cases.closedAt)))
      .orderBy(desc(cases.updatedAt))
      .limit(20),
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.propertyId, id), isNull(tasks.completedAt)))
      .orderBy(desc(tasks.createdAt))
      .limit(15),
    db
      .select()
      .from(communications)
      .where(eq(communications.propertyId, id))
      .orderBy(desc(communications.createdAt))
      .limit(10),
    db
      .select()
      .from(activities)
      .where(eq(activities.propertyId, id))
      .orderBy(desc(activities.occurredAt))
      .limit(25),
  ]);

  const roles = new Map<string, typeof people>();
  for (const p of people) {
    const list = roles.get(p.pc.role) ?? [];
    list.push(p);
    roles.set(p.pc.role, list);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Link href="/properties" className="text-xs text-neutral-500 hover:text-neutral-800">{t["pdetail.back"]}</Link>
      <div className="mt-2 flex items-start gap-3">
        <PageHeader
          title={`${property.addressLine1}${property.addressLine2 ? `, ${property.addressLine2}` : ""}`}
          subtitle={`${property.suburb} ${property.state} ${property.postcode} · ${property.propertyType}`}
        />
        <div className="mt-1"><StatusBadge status={property.status} /></div>
      </div>

      {/* People by role */}
      <SectionTitle>{fmt(t["pdetail.people"], { n: people.length })}</SectionTitle>
      {people.length === 0 ? (
        <EmptyHint>{t["pdetail.noPeople"]}</EmptyHint>
      ) : (
        <div className="space-y-2">
          {[...roles.entries()].map(([role, list]) => (
            <div key={role}>
              <div className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1">{role}</div>
              <div className="grid grid-cols-1 gap-1.5 md:grid-cols-3">
                {list.map(({ contact }) => (
                  <div key={contact.id} className="rounded border border-neutral-200 bg-white px-3 py-2 text-sm">
                    <div className="font-medium">{contact.displayName}</div>
                    <div className="text-xs text-neutral-500">{contact.email ?? "—"} · prefers {contact.preferredLanguage.toUpperCase()}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Open cases */}
      <SectionTitle>{fmt(t["pdetail.openCases"], { n: openCases.length })}</SectionTitle>
      {openCases.length === 0 ? (
        <EmptyHint>{t["pdetail.quiet"]}</EmptyHint>
      ) : (
        <div className="space-y-1.5">
          {openCases.map((c) => (
            <Link key={c.id} href={`/cases/${c.id}`} className="block rounded-lg border border-neutral-200 bg-white px-3 py-2 hover:border-neutral-300">
              <div className="flex items-center gap-2 text-sm">
                <PriorityBadge priority={c.priority} />
                <span className="font-medium">{c.title}</span>
                <span className="ml-auto"><StatusBadge status={c.status} /></span>
              </div>
              <div className="mt-0.5 text-[11px] text-neutral-400">{c.caseType} · updated {formatDateTime(c.updatedAt)}</div>
            </Link>
          ))}
        </div>
      )}

      {/* Open tasks */}
      <SectionTitle>{fmt(t["pdetail.openTasks"], { n: propTasks.length })}</SectionTitle>
      {propTasks.length === 0 ? (
        <EmptyHint>{t["pdetail.noTasks"]}</EmptyHint>
      ) : (
        <div className="space-y-1">
          {propTasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 rounded border border-neutral-200 bg-white px-3 py-2 text-sm">
              <PriorityBadge priority={task.priority} />
              <span>{task.title}</span>
              <span className="ml-auto flex items-center gap-2">
                <span className="text-[11px] text-neutral-400">{fmt(t["pdetail.due"], { t: formatDateTime(task.dueAt) })}</span>
                <form action={completeTaskAction}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <button className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50">Done</button>
                </form>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Recent communications */}
      <SectionTitle>{t["pdetail.recentComms"]}</SectionTitle>
      {recentComms.length === 0 ? (
        <EmptyHint>{t["pdetail.noComms"]}</EmptyHint>
      ) : (
        <div className="space-y-1">
          {recentComms.map((c) => (
            <Link key={c.id} href={`/inbox/${c.id}`} className="block rounded border border-neutral-100 bg-white px-3 py-1.5 hover:border-neutral-300">
              <span className="mr-2 font-mono text-[10px] text-neutral-400">{formatDateTime(c.receivedAt ?? c.sentAt ?? c.createdAt)}</span>
              <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] ${c.direction === "INBOUND" ? "bg-blue-50 text-blue-700" : "bg-neutral-100 text-neutral-600"}`}>{c.direction}</span>
              <span className="text-sm">{c.subject ?? "(no subject)"}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Activity timeline */}
      <SectionTitle>{t["pdetail.activity"]}</SectionTitle>
      {timeline.length === 0 ? (
        <EmptyHint>{t["pdetail.noActivity"]}</EmptyHint>
      ) : (
        <ol className="space-y-1">
          {timeline.map((a) => (
            <li key={a.id} className="rounded border border-neutral-100 bg-white px-3 py-1.5 text-xs">
              <span className="font-mono text-[10px] text-neutral-400">{formatDateTime(a.occurredAt)}</span>
              <span className="mx-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">{a.activityType}</span>
              <span className="text-neutral-700">{a.title}</span>
              {a.caseId && (
                <Link href={`/cases/${a.caseId}`} className="ml-2 text-[11px] text-blue-700 hover:underline">case →</Link>
              )}
            </li>
          ))}
        </ol>
      )}

      {/* Simulated portfolio data — clearly labelled per Spec §17/§21 */}
      <SectionTitle>{t["pdetail.rentLedger"]}</SectionTitle>
      <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/60 p-4 text-sm text-amber-800">
        {fmt(t["pdetail.simulated"], { rent: "$620.00", arrears: "$0.00", inspection: "2026-06-14" })}
      </div>
    </div>
  );
}
