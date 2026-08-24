import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import {
  activities,
  aiActions,
  approvals,
  cases,
  communications,
  contacts,
  properties,
} from "@reos/db";
import { getDb } from "../../_lib/db";
import { getI18n, fmt } from "../../_lib/i18n";
import { getDict } from "../../_lib/dictionary";
import {
  approveAndSendAction,
  approveAction,
  createTaskAction,
  editAndApproveAction,
  rejectAction,
} from "../../actions";
import { ComposeBox } from "../../_components/compose-box";
import {
  ConfidenceBadge,
  PageHeader,
  SectionTitle,
  StatusBadge,
  formatDateTime,
} from "../../_components/ui";

export const dynamic = "force-dynamic";

export default async function InboxDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();
  const { lang, t } = await getI18n();

  const [row] = await db
    .select({
      comm: communications,
      caseId: cases.id,
      caseTitle: cases.title,
      caseStatus: cases.status,
      caseSummary: cases.summary,
      casePriority: cases.priority,
      caseType: cases.caseType,
      propertyAddress: properties.addressLine1,
      senderName: contacts.displayName,
      senderEmail: contacts.email,
    })
    .from(communications)
    .leftJoin(cases, eq(cases.id, communications.caseId))
    .leftJoin(properties, eq(properties.id, communications.propertyId))
    .leftJoin(contacts, eq(contacts.id, communications.senderContactId))
    .where(eq(communications.id, id))
    .limit(1);

  if (!row) notFound();
  const { comm } = row;

  // The pending approval (reply draft) for this message's case, if any.
  let pendingApproval: {
    approvalId: string;
    actionId: string;
    status: string;
    subject?: string;
    bodyEn?: string;
    bodyZh?: string;
    confidence: number | null;
  } | null = null;

  if (row.caseId) {
    const [found] = await db
      .select({
        approvalId: approvals.id,
        approvalStatus: approvals.status,
        actionId: aiActions.id,
        actionStatus: aiActions.status,
        payload: aiActions.proposedPayload,
        confidence: aiActions.confidence,
      })
      .from(approvals)
      .innerJoin(aiActions, eq(aiActions.id, approvals.actionId))
      .where(and(eq(approvals.caseId, row.caseId), eq(approvals.status, "PENDING")))
      .limit(1);
    if (found) {
      const payload = found.payload as { subject?: string; bodyEn?: string; bodyZh?: string };
      pendingApproval = {
        approvalId: found.approvalId,
        actionId: found.actionId,
        status: found.approvalStatus,
        subject: payload.subject,
        bodyEn: payload.bodyEn,
        bodyZh: payload.bodyZh,
        confidence: found.confidence,
      };
    }
  }

  const timeline = row.caseId
    ? await db
        .select()
        .from(activities)
        .where(eq(activities.caseId, row.caseId))
        .orderBy(desc(activities.occurredAt))
        .limit(8)
    : [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/inbox" className="text-xs text-neutral-500 hover:text-neutral-800">{t["detail.backToInbox"]}</Link>
      <div className="mt-2">
        <PageHeader
          title={comm.subject ?? "(no subject)"}
          subtitle={fmt(t["detail.receivedAt"], { t: formatDateTime(comm.receivedAt ?? comm.createdAt), ch: comm.channel })}
        />
      </div>

      {/* Context header (Spec §20) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6 text-sm">
        <Field label={t["detail.fProperty"]} value={row.propertyAddress} href={comm.propertyId ? `/properties/${comm.propertyId}` : undefined} />
        <Field label={t["detail.fCase"]} value={row.caseTitle} href={row.caseId ? `/cases/${row.caseId}` : undefined} />
        <Field label={t["detail.fContact"]} value={row.senderName ? `${row.senderName}${row.senderEmail ? ` · ${row.senderEmail}` : ""}` : null} />
        <Field label={t["detail.fPriority"]} value={row.casePriority} />
        <Field label={t["detail.fClassification"]} value={row.caseType} />
        <div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1">{t["detail.fStatus"]}</div>
          {row.caseStatus ? <StatusBadge status={row.caseStatus} /> : <span className="text-neutral-400">—</span>}
        </div>
      </div>

      {/* Original | 中文 (Spec §20 / §25 — original is immutable) */}
      <SectionTitle>{t["detail.originalZh"]}</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm whitespace-pre-wrap">{comm.originalContent}</div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm whitespace-pre-wrap">
          {comm.translatedContentZh ?? <span className="text-neutral-400">{t["detail.noTranslationYet"]}</span>}
        </div>
      </div>

      {/* AI section */}
      <SectionTitle>{t["detail.aiSummary"]}</SectionTitle>
      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm whitespace-pre-wrap">
        {row.caseSummary ?? <span className="text-neutral-400">{t["detail.noSummary"]}</span>}
      </div>

      {/* Reply draft + approval actions */}
      {pendingApproval && (
        <>
          <SectionTitle right={<ConfidenceBadge score={pendingApproval.confidence} />}>
            {t["detail.replyDraftHeading"]}
          </SectionTitle>
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1">{t["detail.engSendingVersion"]}</div>
                <div className="whitespace-pre-wrap rounded border border-neutral-200 bg-white p-3">{pendingApproval.bodyEn}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1">{t["detail.zhDraft"]}</div>
                <div className="whitespace-pre-wrap rounded border border-neutral-200 bg-white p-3">{pendingApproval.bodyZh}</div>
              </div>
            </div>

            {/* Primary actions (Spec §20) */}
            <div className="mt-3 flex items-center gap-2">
              <form action={approveAndSendAction}>
                <input type="hidden" name="approvalId" value={pendingApproval.approvalId} />
                <button className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600">
                  {t["detail.approveSend"]}
                </button>
              </form>
              <form action={approveAction}>
                <input type="hidden" name="approvalId" value={pendingApproval.approvalId} />
                <button className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100">
                  {t["detail.approveOnly"]}
                </button>
              </form>
              <form action={rejectAction} className="flex items-center gap-1.5">
                <input type="hidden" name="approvalId" value={pendingApproval.approvalId} />
                <input name="note" placeholder={t["detail.reasonPh"]} className="rounded border border-neutral-300 px-2 py-1.5 text-xs w-44" />
                <button className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
                  {t["detail.reject"]}
                </button>
              </form>
            </div>

            {/* Edit before approval (Spec §28) */}
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-neutral-600">{t["detail.editBefore"]}</summary>
              <form action={editAndApproveAction} className="mt-2 space-y-2">
                <input type="hidden" name="approvalId" value={pendingApproval.approvalId} />
                <textarea name="bodyEn" rows={3} required defaultValue={pendingApproval.bodyEn} className="w-full rounded border border-neutral-300 p-2 text-sm" />
                <textarea name="bodyZh" rows={2} placeholder={t["detail.zhFinalPh"]} className="w-full rounded border border-neutral-300 p-2 text-sm" />
                <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700">
                  {t["detail.saveEditApproveSend"]}
                </button>
              </form>
            </details>
          </div>
        </>
      )}

      {/* Chinese Compose → English Send Preview (Spec §25) — offered when no
          AI draft awaits review on this case */}
      {!pendingApproval && row.caseId && (
        <>
          <SectionTitle>{getDict(lang)["compose.heading"]}</SectionTitle>
          <ComposeBox caseId={row.caseId} lang={lang} dict={getDict(lang)} />
        </>
      )}

      {/* Create task */}
      <SectionTitle>{t["detail.createTaskHeading"]}</SectionTitle>
      {row.caseId ? (
        <form action={createTaskAction} className="flex gap-2">
          <input type="hidden" name="caseId" value={row.caseId} />
          <input name="title" required placeholder={t["detail.phTaskTitle"]} className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm" />
          <button className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100">{t["detail.btnCreateTask"]}</button>
        </form>
      ) : (
        <div className="text-sm text-neutral-400">{t["detail.noCaseHint"]}</div>
      )}

      {/* Recent timeline for context */}
      {timeline.length > 0 && (
        <>
          <SectionTitle>{t["detail.timelineHeading"]}</SectionTitle>
          <div className="space-y-1">
            {timeline.map((a) => (
              <div key={a.id} className="flex items-baseline gap-2 rounded border border-neutral-100 bg-white px-3 py-2 text-xs">
                <span className="font-mono text-[10px] text-neutral-400">{formatDateTime(a.occurredAt)}</span>
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">{a.activityType}</span>
                <span className="text-neutral-700">{a.title}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1">{label}</div>
      {href && value ? (
        <Link href={href} className="text-sm text-blue-700 hover:underline line-clamp-1">{value}</Link>
      ) : (
        <div className="text-sm line-clamp-1">{value ?? <span className="text-neutral-400">—</span>}</div>
      )}
    </div>
  );
}
