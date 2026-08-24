import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, isNull, and } from "drizzle-orm";
import {
  activities,
  aiActions,
  auditLogs,
  cases,
  communications,
  contacts,
  properties,
  propertyContacts,
  tasks,
} from "@reos/db";
import { getDb } from "../../_lib/db";
import { completeTaskAction, createTaskAction } from "../../actions";
import {
  ConfidenceBadge,
  EmptyHint,
  PageHeader,
  PriorityBadge,
  SectionTitle,
  StatusBadge,
  formatDateTime,
} from "../../_components/ui";

export const dynamic = "force-dynamic";

/**
 * Screen 6 — Case Detail. The case is the core business object (Spec §2.2):
 * header + AI summary + timeline / communications / tasks / contacts /
 * AI actions — everything that ever happened on this case, in one place.
 */
export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();

  const [row] = await db
    .select({
      kase: cases,
      propertyId: properties.id,
      address: properties.addressLine1,
      suburb: properties.suburb,
    })
    .from(cases)
    .leftJoin(properties, eq(properties.id, cases.propertyId))
    .where(eq(cases.id, id))
    .limit(1);

  if (!row) notFound();
  const { kase } = row;

  const [comms, caseTasks, aiRows, timeline, people, audits] = await Promise.all([
    db.select().from(communications).where(eq(communications.caseId, id)).orderBy(desc(communications.createdAt)).limit(30),
    db.select().from(tasks).where(eq(tasks.caseId, id)).orderBy(desc(tasks.createdAt)).limit(20),
    db.select().from(aiActions).where(eq(aiActions.caseId, id)).orderBy(desc(aiActions.createdAt)).limit(20),
    db.select().from(activities).where(eq(activities.caseId, id)).orderBy(desc(activities.occurredAt)).limit(40),
    kase.propertyId
      ? db
          .select({
            pc: propertyContacts,
            contact: contacts,
          })
          .from(propertyContacts)
          .innerJoin(contacts, eq(contacts.id, propertyContacts.contactId))
          .where(and(eq(propertyContacts.propertyId, kase.propertyId), isNull(propertyContacts.validTo)))
          .limit(30)
      : Promise.resolve([]),
    // Audit trail for this case (append-only view).
    db.select().from(auditLogs).where(eq(auditLogs.entityId, id)).orderBy(desc(auditLogs.createdAt)).limit(15),
  ]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Link href="/" className="text-xs text-neutral-500 hover:text-neutral-800">← Back to AI Home</Link>
      <div className="mt-2 flex items-start gap-3">
        <PageHeader title={kase.title} subtitle={`${kase.caseType} · opened ${formatDateTime(kase.openedAt)}${kase.closedAt ? ` · closed ${formatDateTime(kase.closedAt)}` : ""}`} />
        <div className="mt-1 flex gap-2">
          <PriorityBadge priority={kase.priority} />
          <StatusBadge status={kase.status} />
        </div>
      </div>

      {/* Context strip */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600 mb-4">
        {row.propertyId && (
          <Link href={`/properties/${row.propertyId}`} className="rounded border border-neutral-200 bg-white px-2 py-0.5 hover:border-neutral-400">
            🏠 {row.address}, {row.suburb} →
          </Link>
        )}
        <span className="rounded bg-neutral-100 px-2 py-0.5">{kase.businessDomain}</span>
      </div>

      {/* AI Summary */}
      <SectionTitle>AI Summary</SectionTitle>
      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm whitespace-pre-wrap">
        {kase.summary ?? <span className="text-neutral-400">No summary yet.</span>}
      </div>

      {/* Communications */}
      <SectionTitle>Communications ({comms.length})</SectionTitle>
      {comms.length === 0 ? (
        <EmptyHint>No communications attached to this case.</EmptyHint>
      ) : (
        <div className="space-y-1.5">
          {comms.map((c) => (
            <Link key={c.id} href={`/inbox/${c.id}`} className="block rounded-lg border border-neutral-200 bg-white px-3 py-2 hover:border-neutral-300">
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <StatusBadge status={c.direction} />
                <StatusBadge status={c.channel} />
                <span>{formatDateTime(c.receivedAt ?? c.sentAt ?? c.createdAt)}</span>
                <span className="ml-auto"><ConfidenceBadge score={null} /></span>
              </div>
              <div className="mt-1 text-sm font-medium">{c.subject ?? "(no subject)"}</div>
              <div className="line-clamp-1 text-xs text-neutral-500">{c.originalContent}</div>
            </Link>
          ))}
        </div>
      )}

      {/* Tasks */}
      <SectionTitle>Tasks ({caseTasks.filter((t) => t.status !== "DONE").length} open)</SectionTitle>
      <form action={createTaskAction} className="mb-2 flex gap-2">
        <input type="hidden" name="caseId" value={id} />
        <input name="title" required placeholder="New task title…" className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        <button className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100">Add task</button>
      </form>
      {caseTasks.length === 0 ? (
        <EmptyHint>No tasks on this case.</EmptyHint>
      ) : (
        <div className="space-y-1">
          {caseTasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded border border-neutral-200 bg-white px-3 py-2 text-sm">
              <PriorityBadge priority={t.priority} />
              <span className={t.status === "DONE" ? "line-through text-neutral-400" : ""}>{t.title}</span>
              <span className="text-[10px] uppercase text-neutral-400">{t.source}</span>
              <span className="ml-auto flex items-center gap-2">
                <StatusBadge status={t.status} />
                {t.status !== "DONE" && (
                  <form action={completeTaskAction}>
                    <input type="hidden" name="taskId" value={t.id} />
                    <button className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50">Done</button>
                  </form>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Property contacts */}
      <SectionTitle>People on this Property</SectionTitle>
      {people.length === 0 ? (
        <EmptyHint>No active contacts linked to the property.</EmptyHint>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
          {people.map(({ pc, contact }) => (
            <div key={pc.id} className="rounded border border-neutral-200 bg-white px-3 py-2 text-sm">
              <div className="font-medium">{contact.displayName}</div>
              <div className="text-xs text-neutral-500">{contact.email ?? "—"}</div>
              <span className="mt-1 inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase text-neutral-600">{pc.role}</span>
            </div>
          ))}
        </div>
      )}

      {/* AI actions */}
      <SectionTitle>AI Actions</SectionTitle>
      {aiRows.length === 0 ? (
        <EmptyHint>No AI actions recorded.</EmptyHint>
      ) : (
        <div className="space-y-1">
          {aiRows.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded border border-neutral-200 bg-white px-3 py-2 text-xs">
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono">{a.actionType}</span>
              <ConfidenceBadge score={a.confidence} />
              <span className="text-neutral-500 line-clamp-1">{a.inputSummary ?? a.model}</span>
              <span className="ml-auto"><StatusBadge status={a.status} /></span>
            </div>
          ))}
        </div>
      )}

      {/* Timeline */}
      <SectionTitle>Timeline</SectionTitle>
      {timeline.length === 0 ? (
        <EmptyHint>No activity recorded.</EmptyHint>
      ) : (
        <ol className="space-y-1">
          {timeline.map((a) => (
            <li key={a.id} className="rounded border border-neutral-100 bg-white px-3 py-1.5 text-xs">
              <span className="font-mono text-[10px] text-neutral-400">{formatDateTime(a.occurredAt)}</span>
              <span className="mx-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">{a.activityType}</span>
              <span className="text-neutral-700">{a.title}</span>
            </li>
          ))}
        </ol>
      )}

      {/* Audit trail (read-only, append-only) */}
      {audits.length > 0 && (
        <>
          <SectionTitle>Audit Trail (append-only)</SectionTitle>
          <div className="space-y-1">
            {audits.map((l) => (
              <div key={l.id} className="rounded border border-neutral-100 bg-neutral-50 px-3 py-1.5 font-mono text-[11px] text-neutral-600">
                {formatDateTime(l.createdAt)} · {l.actorType}/{l.actorId?.slice(0, 12) ?? "—"} · {l.action}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
