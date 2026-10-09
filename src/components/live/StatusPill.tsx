import type { JobStatus } from "@/contracts/internal";
import { STATUS_META } from "./types";

export function StatusPill({ status, size = "sm" }: { status: JobStatus; size?: "sm" | "lg" }) {
  const meta = STATUS_META[status] ?? { label: status, color: "var(--muted)" };
  const big = size === "lg";
  return (
    <span
      className={`mono inline-flex items-center gap-2 whitespace-nowrap rounded-full font-bold uppercase tracking-wider ${
        big ? "px-4 py-2 text-sm" : "px-2.5 py-1 text-[11px]"
      }`}
      style={{
        color: meta.color,
        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${meta.color} 35%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className={`inline-block rounded-full ${big ? "h-2.5 w-2.5" : "h-2 w-2"} ${
          status === "in_progress" ? "cl-pulse" : ""
        }`}
        style={{ background: meta.color }}
      />
      {meta.label}
    </span>
  );
}

export function LiveDot({ live, stale }: { live: boolean; stale: boolean }) {
  const color = stale ? "var(--danger)" : live ? "var(--warn)" : "var(--muted)";
  return (
    <span
      className="mono inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest"
      style={{ color }}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${live && !stale ? "cl-pulse" : ""}`} style={{ background: color }} />
      {stale ? "Reconnecting" : live ? "Live" : "Final"}
    </span>
  );
}
