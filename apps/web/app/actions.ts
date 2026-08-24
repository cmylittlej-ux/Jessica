"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import {
  aiActions,
  approvals,
  cases,
  communications,
  contacts,
  tasks,
  users,
} from "@reos/db";
import type { GeneratedReply } from "@reos/ai";
import { createAIGateway, createBuildContext, createMockAIProvider } from "@reos/ai";
import { createApprovalWorkflow, createInboundWorkflow } from "@reos/workflows";
import type { Result } from "@reos/shared";
import { getDb } from "./_lib/db";
import { LANG_COOKIE } from "./_lib/i18n";

/**
 * Server Actions — the ONLY mutation surface for the UI (Spec §2.5: the UI
 * may approve/reject, never execute directly; execution flows through the
 * workflow engine which writes Activity + AuditLog).
 */

function invalidate() {
  revalidatePath("/");
  revalidatePath("/inbox");
  revalidatePath("/tasks");
  revalidatePath("/approvals");
}

async function firstUserId(): Promise<string> {
  const [user] = await getDb().select({ id: users.id }).from(users).limit(1);
  if (!user) throw new Error("no users — run pnpm db:seed");
  return user.id;
}

/** Simulate an inbound email arriving, then run the full workflow on it. */
export async function simulateInboundAction(formData: FormData): Promise<void> {
  const db = getDb();
  const propertyId = String(formData.get("propertyId") ?? "");
  const senderContactId = String(formData.get("senderContactId") ?? "");
  const subject = String(formData.get("subject") ?? "").trim() || "(no subject)";
  const content = String(formData.get("content") ?? "").trim();
  if (!propertyId || !senderContactId || !content) return;

  const commId = `com_sim_${crypto.randomUUID().slice(0, 8)}`;
  await db.insert(communications).values({
    id: commId,
    propertyId,
    direction: "INBOUND",
    channel: "EMAIL",
    senderContactId,
    recipientData: { to: ["neil@bayside.example"] },
    subject,
    originalContent: content,
    originalLanguage: "en",
    status: "RECEIVED",
    externalId: `sim-${commId}`,
    receivedAt: new Date(),
  });

  const process = createInboundWorkflow(db, {
    gateway: createAIGateway({ provider: createMockAIProvider(), db }),
    context: createBuildContext(db),
  });
  await process(commId);
  invalidate();
}

export async function approveAction(formData: FormData): Promise<void> {
  const approvalId = String(formData.get("approvalId") ?? "");
  if (!approvalId) return;
  const workflow = createApprovalWorkflow(getDb());
  await workflow.approve({ approvalId, reviewerId: await firstUserId() });
  invalidate();
}

export async function rejectAction(formData: FormData): Promise<void> {
  const approvalId = String(formData.get("approvalId") ?? "");
  if (!approvalId) return;
  const workflow = createApprovalWorkflow(getDb());
  await workflow.reject({
    approvalId,
    reviewerId: await firstUserId(),
    decisionNote: String(formData.get("note") ?? "") || undefined,
  });
  invalidate();
}

/** Approve + mock-execute in one step (the common path). */
export async function approveAndSendAction(formData: FormData): Promise<void> {
  const approvalId = String(formData.get("approvalId") ?? "");
  if (!approvalId) return;
  const workflow = createApprovalWorkflow(getDb());
  const approved = await workflow.approve({
    approvalId,
    reviewerId: await firstUserId(),
  });
  if (approved.ok) await workflow.executeApproved({ approvalId });
  invalidate();
}

/** §28 edit-before-approval: keep AI draft + human final + EDITED feedback. */
export async function editAndApproveAction(formData: FormData): Promise<void> {
  const approvalId = String(formData.get("approvalId") ?? "");
  const bodyEn = String(formData.get("bodyEn") ?? "").trim();
  const bodyZh = String(formData.get("bodyZh") ?? "").trim();
  if (!approvalId || !bodyEn) return;
  const userId = await firstUserId();

  // Read the proposed payload to preserve subject.
  const pending = await loadApprovalPayload(approvalId);
  const finalOutput: Partial<GeneratedReply> & Record<string, unknown> = {
    subject: pending?.subject ?? "Re: your enquiry",
    bodyEn,
    bodyZh: bodyZh || `[中译] ${bodyEn}`,
    confidence: 1,
  };

  const workflow = createApprovalWorkflow(getDb());
  const edited = await workflow.recordEditedDraft({
    approvalId,
    userId,
    finalOutput,
  });
  if (!edited.ok) return;
  const approved = await workflow.approve({ approvalId, reviewerId: userId });
  if (approved.ok) await workflow.executeApproved({ approvalId });
  invalidate();
}

/** Approve All — low-risk mock actions only (confidence >= 0.90). */
export async function approveAllLowRiskAction(): Promise<void> {
  const db = getDb();
  const pending = await db
    .select({ id: approvals.id })
    .from(approvals)
    .innerJoin(aiActions, eq(aiActions.id, approvals.actionId))
    .where(and(eq(approvals.status, "PENDING")));
  const workflow = createApprovalWorkflow(db);
  const reviewer = await firstUserId();
  for (const row of pending) {
    // Load confidence and only auto-approve high-confidence proposals.
    const [action] = await db
      .select({ confidence: aiActions.confidence })
      .from(aiActions)
      .innerJoin(approvals, eq(approvals.actionId, aiActions.id))
      .where(eq(approvals.id, row.id))
      .limit(1);
    if ((action?.confidence ?? 0) < 0.9) continue;
    const approved = await workflow.approve({ approvalId: row.id, reviewerId: reviewer });
    if (approved.ok) await workflow.executeApproved({ approvalId: row.id });
  }
  invalidate();
}

async function loadApprovalPayload(
  approvalId: string,
): Promise<GeneratedReply | null> {
  const [row] = await getDb()
    .select({ payload: aiActions.proposedPayload })
    .from(approvals)
    .innerJoin(aiActions, eq(aiActions.id, approvals.actionId))
    .where(eq(approvals.id, approvalId))
    .limit(1);
  return row ? (row.payload as GeneratedReply) : null;
}

export async function completeTaskAction(formData: FormData): Promise<void> {
  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return;
  const db = getDb();
  await db
    .update(tasks)
    .set({ status: "DONE", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(tasks.id, taskId));
  invalidate();
}

/** Manual task creation from Inbox Detail / Case Detail. */
export async function createTaskAction(formData: FormData): Promise<void> {
  const db = getDb();
  const caseId = String(formData.get("caseId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!caseId || !title) return;
  const [parent] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!parent) return;
  await db.insert(tasks).values({
    id: `tsk_${crypto.randomUUID().slice(0, 12)}`,
    caseId,
    propertyId: parent.propertyId,
    assignedUserId: parent.assignedUserId ?? (await firstUserId()),
    title,
    status: "OPEN",
    source: "HUMAN",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  invalidate();
}

/** Contact lookup helper used by forms (kept here to reuse the cached client). */
export async function listContactsForProperty(
  propertyId: string,
): Promise<Array<{ id: string; displayName: string }>> {
  const db = getDb();
  const rows = await db
    .select({ id: contacts.id, displayName: contacts.displayName })
    .from(contacts)
    .limit(200);
  void propertyId;
  return rows;
}

export type ActionResult<T> = Result<T, Error>;

// ---------------------------------------------------------------------------
// Phase 6 — Bilingual UX (Spec §25)
// ---------------------------------------------------------------------------

/**
 * UI language switch. Cookie-only: no business table is read or written, so
 * switching can never break business state (Phase 6 gate by construction).
 */
export async function setLanguageAction(formData: FormData): Promise<void> {
  const lang = String(formData.get("lang") ?? "") === "zh" ? "zh" : "en";
  const store = await cookies();
  store.set(LANG_COOKIE, lang, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  invalidate();
}

export interface TranslatePreviewState {
  status: "idle" | "ready" | "error";
  subject?: string;
  bodyZh?: string;
  bodyEn?: string;
  message?: string;
}

/**
 * Chinese Compose step 1 — translate the composed Chinese draft into the
 * English sending version and return it for preview. Nothing is persisted;
 * the gateway writes its own audit trail for the TRANSLATE action.
 */
export async function translateForPreviewAction(
  _prev: TranslatePreviewState,
  formData: FormData,
): Promise<TranslatePreviewState> {
  const subject = String(formData.get("subject") ?? "").trim() || "Re: your enquiry";
  const bodyZh = String(formData.get("bodyZh") ?? "").trim();
  if (!bodyZh) return { status: "error", message: "empty draft" };

  const db = getDb();
  const gateway = createAIGateway({ provider: createMockAIProvider(), db });
  const result = await gateway.translate({
    text: bodyZh,
    sourceLanguage: "zh",
    targetLanguage: "en",
  });
  if (!result.ok) {
    return { status: "error", message: result.error.message };
  }
  return { status: "ready", subject, bodyZh, bodyEn: result.value.translatedText };
}

/**
 * Chinese Compose step 2 — approve & send the English version through the
 * approval state machine. Both language versions are stored on the AIAction:
 * proposedPayload keeps the full bilingual proposal, finalPayload is what the
 * connector sends (bodyEn only — the recipient's sending language).
 */
export async function sendComposedReplyAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get("caseId") ?? "");
  const subject = String(formData.get("subject") ?? "").trim() || "Re: your enquiry";
  const bodyZh = String(formData.get("bodyZh") ?? "").trim();
  const bodyEn = String(formData.get("bodyEn") ?? "").trim();
  if (!caseId || !bodyEn || !bodyZh) return;

  const db = getDb();
  const userId = await firstUserId();

  const payload = { subject, bodyEn, bodyZh, confidence: 1 };
  const actionId = `act_${crypto.randomUUID().slice(0, 12)}`;
  await db.insert(aiActions).values({
    id: actionId,
    caseId,
    actionType: "GENERATE_REPLY",
    inputSummary: "Human-composed Chinese reply with English send preview (Phase 6)",
    proposedPayload: payload,
    finalPayload: { ...payload },
    confidence: 1,
    status: "PROPOSED",
  });

  const approvalId = `apr_${crypto.randomUUID().slice(0, 12)}`;
  await db.insert(approvals).values({
    id: approvalId,
    caseId,
    actionId,
    requestedUserId: userId,
    status: "PENDING",
  });

  const workflow = createApprovalWorkflow(db);
  const approved = await workflow.approve({ approvalId, reviewerId: userId });
  if (approved.ok) await workflow.executeApproved({ approvalId });
  invalidate();
}
