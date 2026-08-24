"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
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
import { createApprovalWorkflow, createInboundWorkflow, completeFollowUpTask, ingestRawEmail } from "@reos/workflows";
import { bulkApproveDecision } from "@reos/domain";
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

/**
 * Simulate an inbound email arriving (Hardening §7): a RAW email — from /
 * to / subject / body — never pre-selected entity ids. Contact, property and
 * case resolution happen inside the workflow, exactly as a real Outlook
 * message would experience. "Advanced Test Overrides" are debug-only.
 */
export async function simulateInboundAction(formData: FormData): Promise<void> {
  const db = getDb();
  const fromEmail = String(formData.get("fromEmail") ?? "").trim();
  const toEmail = String(formData.get("toEmail") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!fromEmail || !content) return;

  // Advanced debug overrides (never used by E2E).
  const overridePropertyId = String(formData.get("overridePropertyId") ?? "").trim();
  const forceAiFailure = formData.get("forceAiFailure") === "on";

  const ingested = await ingestRawEmail(db, {
    fromEmail,
    toEmail: toEmail || undefined,
    subject,
    body: content,
    source: "SIMULATION",
    debugPropertyId: overridePropertyId || undefined,
  });
  if (!ingested.ok || ingested.value.duplicate) {
    invalidate();
    return;
  }

  const provider = createMockAIProvider({ forceFailure: forceAiFailure });
  const process = createInboundWorkflow(db, {
    gateway: createAIGateway({ provider, db }),
    context: createBuildContext(db),
  });
  await process(ingested.value.communicationId);
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

/**
 * Approve All — Hardening §16/§17 gate: an action is bulk-approvable only
 * when its type is in the explicit allowlist AND riskLevel = LOW AND
 * confidence ≥ threshold. Everything else needs individual human review.
 */
export async function approveAllLowRiskAction(): Promise<void> {
  const db = getDb();
  const pending = await db
    .select({
      approvalId: approvals.id,
      caseId: aiActions.caseId,
      actionType: aiActions.actionType,
      riskLevel: aiActions.riskLevel,
      confidence: aiActions.confidence,
    })
    .from(approvals)
    .innerJoin(aiActions, eq(aiActions.id, approvals.actionId))
    .where(eq(approvals.status, "PENDING"));

  const workflow = createApprovalWorkflow(db);
  const reviewer = await firstUserId();

  // P0 Closure §2: restricted-context lookup — the case type and the case's
  // persisted inbound actionRequired decide whether bulk approval is allowed.
  const caseIds = [...new Set(pending.map((r) => r.caseId).filter((x): x is string => Boolean(x)))];
  const contextByCase = new Map<string, { caseType?: string; actionRequired?: string }>();
  if (caseIds.length > 0) {
    const caseRows = await db
      .select({ id: cases.id, caseType: cases.caseType })
      .from(cases)
      .where(inArray(cases.id, caseIds));
    for (const c of caseRows) contextByCase.set(c.id, { caseType: c.caseType });
    const comms = await db
      .select({ caseId: communications.caseId, actionRequired: communications.actionRequired })
      .from(communications)
      .where(and(inArray(communications.caseId, caseIds), eq(communications.direction, "INBOUND")));
    for (const c of comms) {
      if (!c.actionRequired || !c.caseId) continue;
      const ctx = contextByCase.get(c.caseId);
      if (ctx && !ctx.actionRequired) ctx.actionRequired = c.actionRequired;
    }
  }

  for (const row of pending) {
    const ctx = row.caseId ? contextByCase.get(row.caseId) : undefined;
    const verdict = bulkApproveDecision({
      actionType: row.actionType,
      riskLevel: row.riskLevel,
      confidence: row.confidence,
      threshold: 0.9,
      caseType: ctx?.caseType,
      actionRequired: ctx?.actionRequired,
    });
    if (!verdict.allowed) continue;
    const approved = await workflow.approve({ approvalId: row.approvalId, reviewerId: reviewer });
    if (approved.ok) await workflow.executeApproved({ approvalId: row.approvalId });
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
  // P0 Closure §1: closure decision lives in the workflow layer — the case
  // completes only when this was its last open (blocking) task.
  await completeFollowUpTask(getDb(), taskId);
  invalidate();
}

/** §9: retry a failed inbound zh translation — derived data, never the original. */
export async function retryTranslationAction(formData: FormData): Promise<void> {
  const communicationId = String(formData.get("communicationId") ?? "");
  if (!communicationId) return;
  const db = getDb();
  const [message] = await db
    .select({ content: communications.originalContent })
    .from(communications)
    .where(eq(communications.id, communicationId))
    .limit(1);
  if (!message) return;
  const gateway = createAIGateway({ provider: createMockAIProvider(), db });
  const result = await gateway.translate({
    text: message.content,
    sourceLanguage: "en",
    targetLanguage: "zh",
  });
  if (result.ok) {
    await db
      .update(communications)
      .set({ translatedContentZh: result.value.translatedText })
      .where(eq(communications.id, communicationId));
  }
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
