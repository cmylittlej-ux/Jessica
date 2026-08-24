import Link from "next/link";
import { desc, eq, inArray, lte } from "drizzle-orm";
import { approvals, cases, communications, tasks } from "@reos/db";
import { getDb } from "./_lib/db";
import { getI18n, fmt } from "./_lib/i18n";
import {
  Card,
  PageHeader,
  PriorityBadge,
  SectionTitle,
  StatusBadge,
  EmptyHint,
  formatDateTime,
} from "./_components/ui";

export const dynamic = "force-dynamic";

const OPEN_STATUSES = [
  "NEW",
  "AI_PROCESSING",
  "READY_FOR_REVIEW",
  "IN_PROGRESS",
  "WAITING",
  "FOLLOW_UP_DUE",
] as const;

export default async function AiHomePage() {
  const { t } = await getI18n();
  const db = getDb();

  const openCases = await db
    .select()
    .from(cases)
    .where(inArray(cases.status, [...OPEN_STATUSES]))
    .orderBy(desc(cases.updatedAt))
    .limit(100);

  const [pendingApprovals, recentComms] = await Promise.all([
    db.select({ id: approvals.id }).from(approvals).where(eq(approvals.status, "PENDING")),
    db.select({ id: communications.id }).from(communications).orderBy(desc(communications.createdAt)).limit(200),
  ]);

  const urgent = openCases.filter((c) => c.priority === "CRITICAL" || c.priority === "HIGH");
  const waitingOnOthers = openCases.filter(
    (c) => c.status === "WAITING" || c.status === "FOLLOW_UP_DUE",
  );
  const needsReview = openCases.filter((c) => c.status === "READY_FOR_REVIEW");

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const dueTasks = await db.select().from(tasks).where(lte(tasks.dueAt, todayEnd));
  const dueTodayOpen = dueTasks.filter((t) => t.status !== "DONE");

  const picked = new Set<string>();
  const priorities: typeof openCases = [];
  for (const c of [...urgent.filter((x) => x.status !== "WAITING"), ...needsReview]) {
    if (!picked.has(c.id)) {
      picked.add(c.id);
      priorities.push(c);
    }
  }
  for (const c of openCases) {
    if (priorities.length >= 8) break;
    if (!picked.has(c.id)) {
      picked.add(c.id);
      priorities.push(c);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title={t["home.greeting"]}
        subtitle={fmt(t["home.subtitle"], { n: recentComms.length })}
      />

      {/* Four attention cards (Spec §18) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title={t["home.cardUrgent"]} count={urgent.length} tone="alert" href="/tasks?tab=Urgent" />
        <Card title={t["home.cardNeedsApproval"]} count={pendingApprovals.length} tone="warn" href="/approvals" />
        <Card title={t["home.cardWaiting"]} count={waitingOnOthers.length} />
        <Card title={t["home.cardDueToday"]} count={dueTodayOpen.length} href="/tasks?tab=My+Day" />
      </div>

      {/* Today's priorities */}
      <SectionTitle>{t["home.priorities"]}</SectionTitle>
      {priorities.length === 0 ? (
        <EmptyHint>{t["home.emptyPriorities"]}</EmptyHint>
      ) : (
        <div className="space-y-2">
          {priorities.map((c) => (
            <Link
              key={c.id}
              href={`/cases/${c.id}`}
              className="block rounded-lg border border-neutral-200 bg-white p-3 hover:border-neutral-300"
            >
              <div className="flex items-center gap-2">
                <PriorityBadge priority={c.priority} />
                <StatusBadge status={c.status} />
                <span className="text-xs text-neutral-400">{c.caseType.replaceAll("_", " ")}</span>
                <span className="ml-auto text-[11px] text-neutral-400">{formatDateTime(c.updatedAt)}</span>
              </div>
              <div className="mt-1 text-sm font-medium">{c.title}</div>
              {c.summary && (
                <div className="mt-0.5 line-clamp-1 text-xs text-neutral-500">{c.summary.split("\n")[0]}</div>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* Waiting on others */}
      <SectionTitle>{t["home.waitingTitle"]}</SectionTitle>
      {waitingOnOthers.length === 0 ? (
        <EmptyHint>{t["home.waitingEmpty"]}</EmptyHint>
      ) : (
        <div className="space-y-2">
          {waitingOnOthers.slice(0, 5).map((c) => (
            <Link
              key={c.id}
              href={`/cases/${c.id}`}
              className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-sm hover:border-neutral-300"
            >
              <StatusBadge status={c.status} />
              <span className="font-medium">{c.title}</span>
              <span className="ml-auto text-[11px] text-neutral-400">{formatDateTime(c.updatedAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
