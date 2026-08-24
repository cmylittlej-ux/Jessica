/** Route-level loading skeleton (Phase 8 hardening). */
export default function Loading() {
  return (
    <div className="p-6 max-w-6xl mx-auto animate-pulse" aria-busy="true" aria-live="polite">
      <div className="h-6 w-48 bg-neutral-200 rounded mb-2" />
      <div className="h-4 w-72 bg-neutral-100 rounded mb-8" />
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="rounded-lg border border-neutral-100 bg-white p-4">
            <div className="h-3 w-32 bg-neutral-100 rounded mb-2" />
            <div className="h-4 w-full max-w-md bg-neutral-100 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
