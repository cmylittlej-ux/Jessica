"use client";

import { useActionState } from "react";
import { fmt, type Lang } from "../_lib/dictionary";
import {
  sendComposedReplyAction,
  translateForPreviewAction,
} from "../actions";

/**
 * Chinese Compose → English Send Preview (Spec §25 / Phase 6).
 * Step 1: user writes the reply in Chinese; the AI gateway produces the
 * English sending version for preview. Step 2: approving sends the English
 * version through the approval state machine — both language versions are
 * stored on the AIAction (Bilingual by Design, nothing overwrites anything).
 */
export function ComposeBox({
  caseId,
  lang,
  dict,
}: {
  caseId: string;
  lang: Lang;
  dict: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(translateForPreviewAction, {
    status: "idle" as const,
  });

  const ready = state.status === "ready";

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <form action={formAction}>
        <input type="hidden" name="caseId" value={caseId} />
        <input type="hidden" name="lang" value={lang} />
        <input
          name="subject"
          placeholder={dict["compose.subjectPh"]}
          className="mb-2 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <textarea
          name="bodyZh"
          rows={4}
          required
          placeholder={dict["compose.bodyPh"]}
          className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {pending ? dict["compose.translating"] : dict["compose.btnPreview"]}
        </button>
      </form>

      {state.status === "error" && (
        <p className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {dict["compose.errorPrefix"]} {state.message}
        </p>
      )}

      {ready && (
        <form action={sendComposedReplyAction} className="mt-3">
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="subject" value={state.subject} />
          <input type="hidden" name="bodyZh" value={state.bodyZh} />
          <input type="hidden" name="bodyEn" value={state.bodyEn} />
          <div className="rounded border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-emerald-800 mb-1">
              {dict["compose.previewHeading"]}
            </div>
            <div className="text-xs text-neutral-600 mb-1">{state.subject}</div>
            <pre className="whitespace-pre-wrap font-sans text-sm">{state.bodyEn}</pre>
          </div>
          <button className="mt-2 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600">
            {dict["compose.btnSendComposed"]}
          </button>
        </form>
      )}
    </div>
  );
}

export function composeHeading(dict: Record<string, string>) {
  return dict["compose.heading"];
}

export function composeFmt(template: string, vars: Record<string, string | number>) {
  return fmt(template, vars);
}
