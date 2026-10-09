import type { RemediationResultV1 } from "@/contracts/handoff";

type Change = NonNullable<RemediationResultV1["change"]>;
type Mark = "same" | "removed" | "added";

function statementsOf(policy: Record<string, unknown>): unknown[] {
  const s = policy.Statement;
  return Array.isArray(s) ? s : s ? [s] : [];
}

function keyOf(stmt: unknown, i: number): string {
  const sid = stmt && typeof stmt === "object" ? (stmt as { Sid?: unknown }).Sid : undefined;
  return typeof sid === "string" && sid ? `sid:${sid}` : `idx:${i}`;
}

/** A statement is "same" only if the other side has an identical statement under the same key. */
function mark(side: unknown[], other: unknown[], changed: Mark): Mark[] {
  const otherByKey = new Map(other.map((s, i) => [keyOf(s, i), JSON.stringify(s)]));
  return side.map((s, i) => (otherByKey.get(keyOf(s, i)) === JSON.stringify(s) ? "same" : changed));
}

const MARK_STYLE: Record<Mark, { bg: string; bar: string; sign: string }> = {
  same: { bg: "transparent", bar: "transparent", sign: " " },
  removed: { bg: "color-mix(in srgb, var(--danger) 18%, transparent)", bar: "var(--danger)", sign: "−" },
  added: { bg: "color-mix(in srgb, var(--ok) 18%, transparent)", bar: "var(--ok)", sign: "+" },
};

function PolicyColumn({ title, policy, marks, tone }: { title: string; policy: Record<string, unknown>; marks: Mark[]; tone: string }) {
  const stmts = statementsOf(policy);
  const version = typeof policy.Version === "string" ? policy.Version : null;
  return (
    <div className="min-w-0">
      <div className="mono mb-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: tone }}>
        {title}
      </div>
      <div className="mono overflow-x-auto rounded-2xl bg-[var(--cl-code)] p-3 text-[12px] leading-relaxed text-[var(--cl-code-ink)]">
        {version ? <div className="opacity-60">{`Version: "${version}"`}</div> : null}
        {stmts.length === 0 ? <div className="opacity-60">(no statements)</div> : null}
        {stmts.map((s, i) => {
          const m = MARK_STYLE[marks[i] ?? "same"];
          return (
            <div
              key={keyOf(s, i)}
              className="mt-2 rounded-lg py-1.5 pl-3 pr-2"
              style={{ background: m.bg, borderLeft: `3px solid ${m.bar}` }}
            >
              <pre className="whitespace-pre">
                {JSON.stringify(s, null, 2)
                  .split("\n")
                  .map((line) => `${m.sign} ${line}`)
                  .join("\n")}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PolicyDiff({ change, rationale, live }: { change: Change | null; rationale: string; live: boolean }) {
  return (
    <section className="stage p-5 md:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="display text-lg md:text-xl">Policy change</h2>
        {change ? (
          <span className="mono min-w-0 truncate text-xs text-[var(--muted)]">
            {change.role_name || "role"} · {change.policy_name || "policy"}
          </span>
        ) : null}
      </div>

      {!change ? (
        <p className="rounded-2xl bg-[var(--cl-well)] px-4 py-6 text-center text-sm text-[var(--muted)]">
          {live ? "The model is drafting a narrowed policy…" : "No policy change was kept for this job."}
        </p>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <PolicyColumn
              title="Before"
              tone="var(--danger)"
              policy={change.before}
              marks={mark(statementsOf(change.before), statementsOf(change.after), "removed")}
            />
            <PolicyColumn
              title="After"
              tone="var(--ok)"
              policy={change.after}
              marks={mark(statementsOf(change.after), statementsOf(change.before), "added")}
            />
          </div>
          {change.summary.length > 0 ? (
            <ul className="mt-5 space-y-1.5">
              {change.summary.map((s) => (
                <li key={s} className="flex gap-2 text-sm">
                  <span aria-hidden className="text-[var(--action)]">
                    ▸
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      {rationale ? (
        <div className="mt-5 border-t border-[var(--line)] pt-4">
          <div className="mono text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Rationale</div>
          <p className="mt-1 text-sm leading-relaxed">{rationale}</p>
        </div>
      ) : null}
    </section>
  );
}
