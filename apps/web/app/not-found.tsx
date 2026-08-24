import Link from "next/link";

/** 404 boundary (Phase 8 hardening). */
export default function NotFound() {
  return (
    <div className="p-6 max-w-2xl mx-auto mt-16">
      <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
        <h2 className="text-lg font-semibold mb-1">404 — Not found</h2>
        <p className="text-sm text-neutral-500 mb-4">
          This message, case or property does not exist (or was never created). Nothing was modified.
        </p>
        <Link
          href="/"
          className="inline-block rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Back to AI Home
        </Link>
      </div>
    </div>
  );
}
