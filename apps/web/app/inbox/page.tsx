import Link from "next/link";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  approvals,
  aiActions,
  cases,
  communications,
  contacts,
  properties,
} from "@reos/db";
import { getDb } from "../_lib/db";
import { getI18n } from "../_lib/i18n";
import { simulateInboundAction } from "../actions";
import {
  ConfidenceBadge,
  EmptyHint,
  PageHeader,
  PriorityBadge,
  formatDateTime,
} from "../_components/ui";

export const dynamic = "force-dynamic";

const TAB_KEYS = [
  "inbox.tabAll",
  "inbox.tabAttention",
  "inbox.tabApproval",
  "inbox.tabReply",
  "inbox.tabFollowup",
  "inbox.tabWaiting",
  "inbox.tabReview",
  "inbox.tabInformation",
] as const;

/** URL tab param ↔ dict key mapping (URL stays English-stable). */
const TAB_PARAMS: Record<string, (typeof TAB_KEYS)[number]> = {
  All: "inbox.tabAll",
  Attention: "inbox.tabAttention",
  Approval: "inbox.tabApproval",
  Reply: "inbox.tabReply",
  "Follow-up": "inbox.tabFollowup",
  Waiting: "inbox.tabWaiting",
  Review: "inbox.tabReview",
  Information: "inbox.tabInformation",
};

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const params = await searchParams;
  const tabParam = TAB_PARAMS[params.tab ?? "All"] ? params.tab ?? "All" : "All";
  const activeTab = TAB_PARAMS[tabParam];
  const q = (params.q ?? "").trim();
  const { t } = await getI18n();
  const db = getDb();

  // Inbound messages joined with their case for classification context.
  const rows = await db
    .select({
      comm: communications,
      caseTitle: cases.title,
      caseStatus: cases.status,
      casePriority: cases.priority,
      caseId: cases.id,
      propertyAddress: properties.addressLine1,
      senderName: contacts.displayName,
    })
    .from(communications)
    .leftJoin(cases, eq(cases.id, communications.caseId))
    .leftJoin(properties, eq(properties.id, communications.propertyId))
    .leftJoin(contacts, eq(contacts.id, communications.senderContactId))
    .where(
      q
        ? and(
            eq(communications.direction, "INBOUND"),
            or(ilike(communications.subject, `%${q}%`), ilike(communications.originalContent, `%${q}%`)),
          )
        : eq(communications.direction, "INBOUND"),
    )
    .orderBy(desc(communications.receivedAt))
    .limit(100);

  const pendingApprovals = await db
    .select({ caseId: approvals.caseId })
    .from(approvals)
    .where(eq(approvals.status, "PENDING"));
  const approvalCaseIds = new Set(pendingApprovals.map((a) => a.caseId));

  // One aggregate query instead of one query per rendered row (N+1 fix).
  const replyActions = await db
    .select({
      caseId: aiActions.caseId,
      confidence: sql<number>`max(${aiActions.confidence})::float`,
    })
    .from(aiActions)
    .where(and(eq(aiActions.actionType, "GENERATE_REPLY"), inArray(aiActions.status, ["PROPOSED", "APPROVED"])))
    .groupBy(aiActions.caseId);
  const replyCaseIds = new Set(replyActions.map((a) => a.caseId));
  const confidenceByCase = new Map(
    replyActions.filter((a) => a.caseId).map((a) => [a.caseId as string, a.confidence]),
  );

  // Hardening §12: tabs are driven by the PERSISTED classification
  // (actionRequired on the communication + workflow status on the case),
  // not by guessing from the presence of AIActions/approvals.
  const filtered = rows.filter(({ comm, caseStatus }) => {
    switch (activeTab) {
      case "inbox.tabAttention":
        return comm.actionRequired === "URGENT_ACTION" || comm.actionRequired === "DECISION_REQUIRED";
      case "inbox.tabApproval":
        return comm.actionRequired === "APPROVAL_REQUIRED" || approvalCaseIds.has(comm.caseId);
      case "inbox.tabReply":
        return comm.actionRequired === "REPLY_REQUIRED" || replyCaseIds.has(comm.caseId);
      case "inbox.tabFollowup":
        return comm.actionRequired === "FOLLOW_UP_REQUIRED" || caseStatus === "FOLLOW_UP_DUE";
      // P0 Closure §6: Waiting is a first-class business state — never folded
      // into Information.
      case "inbox.tabWaiting":
        return comm.actionRequired === "WAITING_FOR_OTHER" || caseStatus === "WAITING";
      case "inbox.tabReview":
        return comm.classificationConfidence !== null && comm.classificationConfidence < 0.7 || caseStatus === "READY_FOR_REVIEW";
      case "inbox.tabInformation":
        return (
          comm.actionRequired === "INFORMATION_ONLY" ||
          comm.actionRequired === "NO_ACTION"
        );
      default:
        return true;
    }
  });

  const [allProperties] = await Promise.all([
    db.select({ id: properties.id, address: properties.addressLine1 }).from(properties).limit(50),
  ]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader title={t["inbox.title"]} subtitle={t["inbox.subtitle"]} />

      {/* Raw email simulation (Hardening §7): no entity pre-selection — the
          system resolves contact / property / case itself. Advanced Test
          Overrides are debug-only and never used by E2E. */}
      <form action={simulateInboundAction} className="mb-5 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500 mb-2">
          {t["inbox.simulateHeader"]}
        </div>
        <div className="grid grid-cols-[1fr_1fr_2fr] gap-2 mb-2">
          <input name="fromEmail" required type="email" aria-label="From email" data-testid="sim-from" placeholder="tenant@example.com" className="rounded border border-neutral-300 px-2 py-1.5 text-sm" />
          <input name="toEmail" type="email" aria-label="To email" data-testid="sim-to" placeholder="neil@bayside.example" defaultValue="neil@bayside.example" className="rounded border border-neutral-300 px-2 py-1.5 text-sm" />
          <input name="subject" aria-label="Subject" data-testid="sim-subject" placeholder={t["inbox.phSubject"]} className="rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        </div>
        <div className="flex gap-2">
          <textarea name="content" rows={2} required aria-label="Email body" data-testid="sim-body" placeholder={t["inbox.phBody"]} className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm" />
          <button type="submit" data-testid="sim-submit" className="self-stretch rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700">
            {t["inbox.btnSendProcess"]}
          </button>
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] uppercase tracking-widest text-neutral-400 hover:text-neutral-600">Advanced test overrides</summary>
          <div className="mt-2 flex items-center gap-4">
            <select name="overridePropertyId" aria-label="Override property (debug only)" data-testid="sim-override-property" className="rounded border border-neutral-300 px-2 py-1 text-xs bg-white">
              <option value="">— no property override —</option>
              {allProperties.map((p) => (
                <option key={p.id} value={p.id}>{p.address}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-neutral-500">
              <input type="checkbox" name="forceAiFailure" data-testid="sim-force-failure" className="rounded border-neutral-300" />
              Force AI failure (debug)
            </label>
          </div>
        </details>
      </form>

      {/* Tabs + search */}
      <div className="flex items-center gap-1 border-b border-neutral-200 mb-3 flex-wrap">
        {TAB_KEYS.map((key) => {
          const param = Object.entries(TAB_PARAMS).find(([, v]) => v === key)?.[0];
          return (
            <Link
              key={key}
              href={`/inbox?tab=${encodeURIComponent(param ?? "")}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`px-3 py-1.5 text-sm rounded-t -mb-px ${
                key === activeTab ? "border border-b-white border-neutral-200 bg-white font-medium" : "text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {t[key]}
            </Link>
          );
        })}
        <form action="/inbox" className="ml-auto mb-1 flex gap-1.5">
          <input type="hidden" name="tab" value={tabParam} />
          <input name="q" defaultValue={q} placeholder={t["inbox.searchPh"]} className="rounded border border-neutral-300 px-2 py-1 text-xs w-56" />
          <button className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100">{t["inbox.searchBtn"]}</button>
        </form>
      </div>

      {/* Message list */}
      {filtered.length === 0 ? (
        <EmptyHint>{t["inbox.noMessages"]}</EmptyHint>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(({ comm, caseTitle, casePriority, caseId, propertyAddress, senderName }) => {
            const senderFallback =
              (comm.senderData as { email?: string } | null)?.email ?? "unknown sender";
            return (
            <Link
              key={comm.id}
              href={`/inbox/${comm.id}`}
              className="block rounded-lg border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-300"
            >
              <div className="flex items-center gap-2">
                <PriorityBadge priority={casePriority} />
                <span className="text-xs text-neutral-500">{propertyAddress ?? "—"}</span>
                <span className="text-xs text-neutral-400">·</span>
                <span className="text-xs text-neutral-500">{senderName ?? senderFallback}</span>
                <ConfidenceBadge score={caseId ? confidenceByCase.get(caseId) ?? null : null} />
                <span className="ml-auto text-[11px] text-neutral-400">{formatDateTime(comm.receivedAt ?? comm.createdAt)}</span>
              </div>
              <div className="mt-1 text-sm font-medium">{comm.subject}</div>
              <div className="mt-0.5 line-clamp-1 text-xs text-neutral-500">{comm.originalContent}</div>
              {caseTitle && (
                <div className="mt-1 text-[11px] text-neutral-400">
                  {t["common.caseLabel"]} {caseTitle}
                  {(approvalCaseIds.has(comm.caseId)) && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">{t["inbox.awaitingApproval"]}</span>}
                </div>
              )}
            </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
