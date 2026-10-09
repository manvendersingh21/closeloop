import Link from "next/link";
import type { ReactNode } from "react";

// Dark-mode values for the global tokens, scoped to the live pages so the
// marketing home page is untouched. Light mode inherits :root from globals.css.
const THEME_CSS = `
.cl-live {
  --cl-page: linear-gradient(180deg, var(--sky-top) 0%, var(--sky-mid) 30%, #f4f8fc 70%, #e7f0f7 100%);
  --cl-well: rgba(255, 255, 255, 0.7);
  --cl-code: #1a2332;
  --cl-code-ink: #e8efe9;
  --cl-ok-bg: color-mix(in srgb, var(--ok) 12%, var(--surface-solid));
  --cl-bad-bg: color-mix(in srgb, var(--danger) 11%, var(--surface-solid));
  --cl-warn-bg: color-mix(in srgb, var(--warn) 13%, var(--surface-solid));
  --cl-stage-border: rgba(255, 255, 255, 0.65);
  color: var(--ink);
}
@media (prefers-color-scheme: dark) {
  .cl-live {
    --sky-top: #0d1724;
    --sky-mid: #101b29;
    --sky-bottom: #0b1420;
    --ink: #e4ecf4;
    --muted: #93a4b6;
    --line: #2a3a4d;
    --surface: rgba(22, 33, 48, 0.82);
    --surface-solid: #172334;
    --action: #3fb3d6;
    --action-deep: #7fd0ea;
    --action-rim: #0b4f66;
    --ok: #4cc488;
    --warn: #e6a640;
    --danger: #ef6a5b;
    --shadow-soft: 0 18px 40px rgba(0, 0, 0, 0.35);
    --cl-page: linear-gradient(180deg, #0d1724 0%, #101b29 40%, #0b1420 100%);
    --cl-well: rgba(255, 255, 255, 0.04);
    --cl-code: #0a121c;
    --cl-stage-border: rgba(255, 255, 255, 0.07);
    color-scheme: dark;
  }
}
.cl-live .stage { border-color: var(--cl-stage-border); }
@keyframes cl-pulse { 0%, 100% { opacity: 0.45; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.1); } }
.cl-pulse { animation: cl-pulse 1.4s ease-in-out infinite; }
@keyframes cl-shimmer { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.9; } }
.cl-skel { background: var(--line); border-radius: 12px; animation: cl-shimmer 1.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .cl-pulse, .cl-skel { animation: none; } }
`;

export function LiveShell({ children, crumb }: { children: ReactNode; crumb?: ReactNode }) {
  return (
    <div className="cl-live min-h-[100svh] w-full" style={{ background: "var(--cl-page)" }}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 pb-2 pt-6 md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="brand shrink-0 text-xl text-[var(--ink)] md:text-2xl">
            CloseLoop
          </Link>
          {crumb ? (
            <span className="mono min-w-0 truncate text-xs text-[var(--muted)]">/ {crumb}</span>
          ) : null}
        </div>
        <Link
          href="/jobs"
          className="mono shrink-0 rounded-full border border-[var(--line)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)] transition hover:text-[var(--ink)]"
        >
          All jobs
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-20 pt-4 md:px-8">
        {children}
      </main>
    </div>
  );
}
