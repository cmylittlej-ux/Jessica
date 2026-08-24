import Link from "next/link";
import type { ReactNode } from "react";

/** Neutral, compact UI primitives (Spec §17: no rainbow colors, subtle borders). */

const PRIORITY_STYLES: Record<string, string> = {
  CRITICAL: "bg-red-50 text-red-700 border-red-200",
  HIGH: "bg-orange-50 text-orange-700 border-orange-200",
  NORMAL: "bg-neutral-100 text-neutral-600 border-neutral-200",
  LOW: "bg-neutral-50 text-neutral-400 border-neutral-200",
};

export function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  if (!priority) return null;
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.NORMAL}`}>
      {priority}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function ConfidenceBadge({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return null;
  const band =
    score >= 0.9 ? "HIGH" : score >= 0.7 ? "REVIEW" : "MANUAL";
  const style =
    band === "HIGH"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : band === "REVIEW"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-red-50 text-red-700 border-red-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${style}`}>
      {band} · {score.toFixed(2)}
    </span>
  );
}

export function Card({
  title,
  count,
  href,
  tone = "neutral",
  children,
}: {
  title: string;
  count?: number;
  href?: string;
  tone?: "neutral" | "alert" | "warn";
  children?: ReactNode;
}) {
  const toneClass =
    tone === "alert"
      ? "border-red-200"
      : tone === "warn"
        ? "border-amber-200"
        : "border-neutral-200";
  const body = (
    <div className={`rounded-lg border ${toneClass} bg-white p-4 h-full hover:border-neutral-300 transition-colors`}>
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{title}</div>
        <div className="text-2xl font-semibold tabular-nums">{count ?? "—"}</div>
      </div>
      {children}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-8 mb-3 flex items-center justify-between border-b border-neutral-200 pb-1.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">{children}</h2>
      {right}
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm text-neutral-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-400">{children}</div>;
}

export function formatDateTime(value: Date | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
