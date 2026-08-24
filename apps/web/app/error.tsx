"use client";

import Link from "next/link";

/**
 * Route-level error boundary (Phase 8 hardening). The Retry button calls
 * reset() to re-render the failed segment — business state lives in Postgres,
 * so a retry is always safe.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-6 max-w-2xl mx-auto mt-16">
      <div className="rounded-lg border border-red-200 bg-red-50 p-6" role="alert">
        <h2 className="text-lg font-semibold text-red-800 mb-1">Something went wrong</h2>
        <p className="text-sm text-red-700 mb-4">
          An unexpected error occurred while rendering this screen. Your data is safe —
          all state is persisted in the database. Try again, or head back to AI Home.
        </p>
        {error.digest && (
          <p className="font-mono text-[11px] text-red-400 mb-4">digest: {error.digest}</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={reset}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Retry
          </button>
          <Link
            href="/"
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            Back to AI Home
          </Link>
        </div>
      </div>
    </div>
  );
}
