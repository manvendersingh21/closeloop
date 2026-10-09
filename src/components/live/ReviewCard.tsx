import type { ReviewDecision, ReviewInfo, ShipInfo } from "./review";

const DECISION_META: Record<ReviewDecision, { label: string; color: string; headline: string }> = {
  approved: { label: "Approved", color: "var(--ok)", headline: "Guild reviewer approved the patch" },
  rejected: { label: "Rejected", color: "var(--danger)", headline: "Guild reviewer rejected the patch" },
  unavailable: {
    label: "Unavailable",
    color: "var(--warn)",
    headline: "No reviewer verdict; the live proof decides",
  },
};

export function ReviewCard({ review }: { review: ReviewInfo }) {
  const meta = DECISION_META[review.decision];
  return (
    <section
      aria-live="polite"
      className="rounded-[var(--radius-stage)] border-2 px-5 py-4 md:px-7"
      style={{
        borderColor: `color-mix(in srgb, ${meta.color} 45%, transparent)`,
        background: `color-mix(in srgb, ${meta.color} 8%, var(--surface-solid))`,
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow" style={{ color: meta.color }}>
            Review
          </p>
          <p className="display mt-1 text-lg leading-snug md:text-xl">{meta.headline}</p>
        </div>
        <span
          className="mono inline-flex shrink-0 items-center gap-2 self-start rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wider sm:self-center"
          style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 14%, transparent)` }}
        >
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
          {meta.label}
        </span>
      </div>
      {review.reasons ? (
        <p
          className="mt-3 break-words text-sm leading-relaxed"
          style={{ color: review.decision === "rejected" ? "var(--danger)" : "var(--muted)" }}
        >
          {review.reasons}
        </p>
      ) : null}
      {review.sessionUrl ? (
        <a
          href={review.sessionUrl}
          target="_blank"
          rel="noreferrer"
          className="mono mt-3 inline-block text-xs font-bold text-[var(--action)] underline underline-offset-2"
        >
          Guild review session ↗
        </a>
      ) : null}
    </section>
  );
}

export function ShipLine({ ship }: { ship: ShipInfo }) {
  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
      <span className="mono text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Shipped</span>
      {ship.prUrl ? (
        <a
          href={ship.prUrl}
          target="_blank"
          rel="noreferrer"
          className="mono min-w-0 break-all text-xs font-bold text-[var(--action)] underline underline-offset-2"
        >
          {ship.prUrl.replace(/^https?:\/\//, "")} ↗
        </a>
      ) : (
        <span className="min-w-0 break-words text-[var(--muted)]">Pull request not opened: {ship.reason}</span>
      )}
    </p>
  );
}
