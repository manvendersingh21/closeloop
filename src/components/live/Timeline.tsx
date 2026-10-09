import type { JobEvent } from "@/contracts/internal";
import { splitGuildLinks } from "./links";

const LEVEL_COLOR: Record<JobEvent["level"], string> = {
  info: "var(--muted)",
  warn: "var(--warn)",
  error: "var(--danger)",
};

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function Timeline({ events, live }: { events: JobEvent[]; live: boolean }) {
  const ordered = [...events].sort((a, b) => a.ts.localeCompare(b.ts));
  return (
    <section className="stage p-5 md:p-6">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="display text-lg md:text-xl">Timeline</h2>
        <span className="mono text-xs text-[var(--muted)]">{ordered.length} events</span>
      </div>
      {ordered.length === 0 ? (
        <p className="rounded-2xl bg-[var(--cl-well)] px-4 py-6 text-center text-sm text-[var(--muted)]">
          {live ? "Waiting for the first event…" : "No events were recorded."}
        </p>
      ) : (
        <ol className="relative space-y-2 border-l-2 border-[var(--line)] pl-4">
          {ordered.map((e, i) => {
            const color = LEVEL_COLOR[e.level] ?? "var(--muted)";
            const loud = e.level !== "info";
            return (
              <li
                key={`${e.ts}-${i}`}
                className="relative rounded-xl px-3 py-2"
                style={{ background: loud ? `color-mix(in srgb, ${color} 10%, transparent)` : undefined }}
              >
                <span
                  aria-hidden
                  className="absolute -left-[23px] top-3.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface-solid)]"
                  style={{ background: loud ? color : "var(--action)" }}
                />
                <div className="mono flex flex-wrap items-center gap-x-2 text-[10px] uppercase tracking-wider">
                  <span className="text-[var(--muted)]">{clock(e.ts)}</span>
                  <span className="font-bold text-[var(--action-deep)]">{e.stage}</span>
                  {loud ? (
                    <span className="font-bold" style={{ color }}>
                      {e.level}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 break-words text-sm leading-relaxed" style={{ color: loud ? color : undefined }}>
                  {splitGuildLinks(e.message).map((p, j) =>
                    p.url ? (
                      <a
                        key={j}
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-bold text-[var(--action)] underline underline-offset-2"
                      >
                        {p.text}
                      </a>
                    ) : (
                      <span key={j}>{p.text}</span>
                    ),
                  )}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
