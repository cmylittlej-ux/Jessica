import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { aiActions, approvals, cases, properties } from "@reos/db";
import type { GeneratedReply } from "@reos/ai";
import { getDb } from "../_lib/db";
import { getI18n } from "../_lib/i18n";
import {
  approveAction,
  approveAndSendAction,
  approveAllLowRiskAction,
  editAndApproveAction,
  rejectAction,
} from "../actions";
import {
  ConfidenceBadge,
  EmptyHint,
  PageHeader,
  StatusBadge,
  formatDateTime,
} from "../_components/ui";

export const dynamic = "force-dynamic";

/**
 * Screen 5 — Approvals. Every pending AI proposal shown as
 * WHAT / WHY / PROPERTY / PERSON / RISK / PROPOSED CONTENT (Spec §20),
 * with Approve / Edit & Approve / Reject per item and a bulk
 * "Approve All (high-confidence only)" shortcut.
 */
export default async function ApprovalsPage() {
  const { t } = await getI18n();
  const db = getDb();

  const rows = await db
    .select({
      approval: approvals,
      action: aiActions,
      caseTitle: cases.title,
      caseId: cases.id,
      propertyAddress: properties.addressLine1,
    })
    .from(approvals)
    .innerJoin(aiActions, eq(aiActions.id, approvals.actionId))
    .leftJoin(cases, eq(cases.id, approvals.caseId))
    .leftJoin(properties, eq(properties.id, cases.propertyId))
    .where(eq(approvals.status, "PENDING"))
    .orderBy(desc(approvals.requestedAt))
    .limit(50);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader title={t["approvals.title"]} subtitle={t["approvals.subtitle"]} />

      {rows.length > 1 && (
        <form action={approveAllLowRiskAction} className="mb-4">
          <button className="rounded-md border border-emerald-700 bg-white px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-50">
            {t["approvals.approveAll"]}
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <EmptyHint>{t["approvals.empty"]}</EmptyHint>
      ) : (
        <div className="space-y-4">
          {rows.map(({ approval, action, caseTitle, caseId, propertyAddress }) => {
            const payload = action.proposedPayload as Partial<GeneratedReply> & Record<string, unknown>;
            const isReply = action.actionType === "GENERATE_REPLY";
            const band =
              (action.confidence ?? 0) >= 0.9
                ? { label: "LOW RISK", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
                : (action.confidence ?? 0) >= 0.7
                  ? { label: "REVIEW", cls: "bg-amber-50 text-amber-700 border-amber-200" }
                  : { label: "HIGH RISK", cls: "bg-red-50 text-red-700 border-red-200" };

            return (
              <div key={approval.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                {/* Header row */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600 mb-3">
                  <span className={`rounded border px-1.5 py-0.5 font-medium ${band.cls}`}>{band.label}</span>
                  <StatusBadge status={action.actionType} />
                  <ConfidenceBadge score={action.confidence} />
                  <span className="text-neutral-400">·</span>
                  {caseId && (
                    <Link href={`/cases/${caseId}`} className="text-blue-700 hover:underline">
                      Case: {caseTitle}
                    </Link>
                  )}
                  {propertyAddress && <span>{propertyAddress}</span>}
                  <span className="ml-auto text-[11px] text-neutral-400">
                    requested {formatDateTime(approval.requestedAt)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                  <Field label={t["approvals.fWhat"]} value={String(payload.subject ?? action.actionType)} />
                  <Field label={t["approvals.fWhy"]} value={action.inputSummary ?? undefined} />
                  <Field label={t["approvals.fProperty"]} value={propertyAddress ?? undefined} />
                  <Field label={t["approvals.fPerson"]} value={String(payload.recipientName ?? "—")} />
                  <Field label={t["approvals.fRisk"]} value={`${band.label} · confidence ${action.confidence?.toFixed(2) ?? "n/a"}`} />
                </div>

                {/* Proposed content */}
                <div className="mt-3 text-[11px] uppercase tracking-wide text-neutral-400 mb-1">{t["approvals.proposedContent"]}</div>
                {isReply ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="whitespace-pre-wrap rounded border border-neutral-200 bg-white p-3 text-sm">{payload.bodyEn}</div>
                    <div className="whitespace-pre-wrap rounded border border-neutral-200 bg-white p-3 text-sm">{payload.bodyZh}</div>
                  </div>
                ) : (
                  <pre className="overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-3 text-xs font-mono">
                    {JSON.stringify(payload, null, 2)}
                  </pre>
                )}

                {/* Actions */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <form action={approveAndSendAction}>
                    <input type="hidden" name="approvalId" value={approval.id} />
                    <button className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600">
                      {t["approvals.approveExecute"]}
                    </button>
                  </form>
                  <form action={approveAction}>
                    <input type="hidden" name="approvalId" value={approval.id} />
                    <button className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100">
                      {t["approvals.approveOnly"]}
                    </button>
                  </form>
                  <form action={rejectAction} className="flex items-center gap-1.5">
                    <input type="hidden" name="approvalId" value={approval.id} />
                    <input name="note" placeholder={t["approvals.reasonPh"]} className="rounded border border-neutral-300 px-2 py-1.5 text-xs w-40" />
                    <button className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
                      {t["approvals.reject"]}
                    </button>
                  </form>
                  {isReply && (
                    <details className="ml-auto w-full">
                      <summary className="cursor-pointer text-xs font-medium text-neutral-600">{t["approvals.editBefore"]}</summary>
                      <form action={editAndApproveAction} className="mt-2 space-y-2">
                        <input type="hidden" name="approvalId" value={approval.id} />
                        <textarea name="bodyEn" rows={3} required defaultValue={payload.bodyEn} className="w-full rounded border border-neutral-300 p-2 text-sm" />
                        <textarea name="bodyZh" rows={2} placeholder={t["approvals.zhFinalPh"]} className="w-full rounded border border-neutral-300 p-2 text-sm" />
                        <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700">
                          {t["approvals.saveEditExecute"]}
                        </button>
                      </form>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-neutral-400 mb-0.5">{label}</div>
      <div className="line-clamp-2">{value ?? <span className="text-neutral-400">—</span>}</div>
    </div>
  );
}
