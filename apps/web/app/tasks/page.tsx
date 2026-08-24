import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { cases, properties, tasks } from "@reos/db";
import { getDb } from "../_lib/db";
import { completeTaskAction } from "../actions";
import { EmptyHint, PageHeader, PriorityBadge, StatusBadge, formatDateTime } from "../_components/ui";

export const dynamic = "force-dynamic";

const TABS = ["My Day", "Urgent", "Waiting", "All"] as const;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const tab = TABS.includes((params.tab ?? "All") as (typeof TABS)[number]) ? params.tab ?? "All" : "All";
  const db = getDb();

  const rows = await db
    .select({
      task: tasks,
      caseId: cases.id,
      caseTitle: cases.title,
      casePriority: cases.priority,
      propertyAddress: properties.addressLine1,
    })
    .from(tasks)
    .leftJoin(cases, eq(cases.id, tasks.caseId))
    .leftJoin(properties, eq(properties.id, tasks.propertyId))
    .orderBy(desc(tasks.createdAt))
    .limit(200);

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const filtered = rows.filter(({ task, casePriority }) => {
    switch (tab) {
      case "My Day": {
        if (task.status === "DONE" || task.status === "CANCELLED") return false;
        return !task.dueAt || task.dueAt <= todayEnd;
      }
      case "Urgent":
        return (
          task.status !== "DONE" &&
          ((casePriority === "HIGH" || casePriority === "CRITICAL") ||
            task.title.toLowerCase().includes("urgent"))
        );
      case "Waiting":
        return task.status === "WAITING";
      default:
        return true;
    }
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader title="My Tasks" subtitle="AI-created and human tasks in one queue. Completing writes the audit trail." />

      <div className="flex items-center gap-1 border-b border-neutral-200 mb-3">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/tasks?tab=${encodeURIComponent(t)}`}
            className={`px-3 py-1.5 text-sm rounded-t -mb-px ${
              t === tab ? "border border-b-white border-neutral-200 bg-white font-medium" : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {t}
          </Link>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyHint>No tasks in this view.</EmptyHint>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wide text-neutral-400">
              <th className="py-2 pr-2 font-medium">Priority</th>
              <th className="py-2 pr-2 font-medium">Task</th>
              <th className="py-2 pr-2 font-medium">Property</th>
              <th className="py-2 pr-2 font-medium">Case</th>
              <th className="py-2 pr-2 font-medium">Source</th>
              <th className="py-2 pr-2 font-medium">Due</th>
              <th className="py-2 pr-2 font-medium">Status</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ task, caseId, caseTitle, casePriority, propertyAddress }) => {
              const overdue = task.dueAt && task.dueAt < new Date() && task.status !== "DONE";
              return (
                <tr key={task.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                  <td className="py-2 pr-2"><PriorityBadge priority={casePriority} /></td>
                  <td className="py-2 pr-2">
                    {task.status === "DONE" ? (
                      <span className="line-through text-neutral-400">{task.title}</span>
                    ) : (
                      task.title
                    )}
                  </td>
                  <td className="py-2 pr-2 text-xs text-neutral-500 line-clamp-1 max-w-40">{propertyAddress ?? "—"}</td>
                  <td className="py-2 pr-2 text-xs">
                    {caseId ? (
                      <Link href={`/cases/${caseId}`} className="text-blue-700 hover:underline line-clamp-1 max-w-48 block">{caseTitle}</Link>
                    ) : "—"}
                  </td>
                  <td className="py-2 pr-2"><span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium">{task.source}</span></td>
                  <td className={`py-2 pr-2 text-xs tabular-nums ${overdue ? "text-red-600 font-medium" : "text-neutral-500"}`}>
                    {formatDateTime(task.dueAt)}
                  </td>
                  <td className="py-2 pr-2"><StatusBadge status={task.status} /></td>
                  <td className="py-2">
                    {task.status !== "DONE" && task.status !== "CANCELLED" && (
                      <form action={completeTaskAction}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <button className="rounded border border-emerald-300 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50">
                          Done
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
