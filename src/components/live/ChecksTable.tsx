import type { CheckResult } from "@/contracts/internal";

const PHASES: { id: CheckResult["phase"]; label: string; hint: string }[] = [
  { id: "baseline", label: "Baseline", hint: "Exploit must reproduce before any change" },
  { id: "simulate", label: "Simulate", hint: "Offline policy checks per attempt" },
  { id: "live", label: "Live", hint: "Against the running Akash deployment" },
  { id: "rollback", label: "Rollback", hint: "After restoring the original policy" },
];

type Verdict = { label: string; color: string; bg: string };

const PASS: Verdict = { label: "pass", color: "var(--ok)", bg: "var(--cl-ok-bg)" };
const FAIL: Verdict = { label: "fail", color: "var(--danger)", bg: "var(--cl-bad-bg)" };
const REPRODUCED: Verdict = { label: "reproduced", color: "var(--warn)", bg: "var(--cl-warn-bg)" };
const NOT_REPRODUCED: Verdict = { label: "not reproduced", color: "var(--muted)", bg: "var(--cl-well)" };

/** Baseline rows record the exploit before the fix, so they are evidence, not pass/fail. */
function verdictOf(c: CheckResult): Verdict {
  if (c.phase === "baseline") {
    return c.expected === "deny" && c.actual === "allow" ? REPRODUCED : NOT_REPRODUCED;
  }
  return c.passed ? PASS : FAIL;
}

function Decision({ value }: { value: string }) {
  const color = value === "allow" ? "var(--action)" : value === "deny" ? "var(--ink)" : "var(--danger)";
  return (
    <span className="mono text-xs font-bold uppercase" style={{ color }}>
      {value}
    </span>
  );
}

export function ChecksTable({ checks, live }: { checks: CheckResult[]; live: boolean }) {
  const groups = PHASES.map((p) => ({ ...p, rows: checks.filter((c) => c.phase === p.id) })).filter(
    (g) => g.rows.length > 0,
  );
  const graded = checks.filter((c) => c.phase !== "baseline");
  const passed = graded.filter((c) => c.passed).length;
  const hasBaseline = groups.some((g) => g.id === "baseline");

  return (
    <section className="stage overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] px-5 py-4 md:px-6">
        <h2 className="display text-lg md:text-xl">Checks</h2>
        <span className="mono text-xs tabular-nums text-[var(--muted)]">
          {passed}/{graded.length} passed
        </span>
      </div>
      {groups.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-[var(--muted)] md:px-6">
          {live ? "No checks recorded yet." : "No checks were recorded for this job."}
        </p>
      ) : (
        <>
          {hasBaseline ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--line)] px-5 py-2.5 text-xs text-[var(--muted)] md:px-6">
              <span
                className="mono rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                style={{ color: REPRODUCED.color, background: REPRODUCED.bg }}
              >
                {REPRODUCED.label}
              </span>
              <span>= exploit confirmed before the fix. Baseline rows are evidence, not failures.</span>
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
                <tr>
                  <th className="px-5 py-2.5 font-bold md:px-6">Check</th>
                  <th className="px-3 py-2.5 font-bold">Attempt</th>
                  <th className="px-3 py-2.5 font-bold">Expected</th>
                  <th className="px-3 py-2.5 font-bold">Actual</th>
                  <th className="px-3 py-2.5 font-bold">Result</th>
                  <th className="px-3 py-2.5 pr-5 font-bold md:pr-6">Detail</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.id}>
                  <tr className="border-t border-[var(--line)] bg-[var(--cl-well)]">
                    <th colSpan={6} scope="colgroup" className="px-5 py-2 text-left md:px-6">
                      <span className="text-xs font-extrabold uppercase tracking-wider">{g.label}</span>
                      <span className="ml-2 text-xs font-normal text-[var(--muted)]">{g.hint}</span>
                    </th>
                  </tr>
                  {g.rows.map((c, i) => {
                    const v = verdictOf(c);
                    return (
                      <tr key={`${g.id}-${c.check_id}-${c.attempt}-${i}`} className="border-t border-[var(--line)]">
                        <td className="mono px-5 py-2.5 text-xs md:px-6">{c.check_id}</td>
                        <td className="mono px-3 py-2.5 text-xs tabular-nums text-[var(--muted)]">#{c.attempt}</td>
                        <td className="px-3 py-2.5">
                          <Decision value={c.expected} />
                        </td>
                        <td className="px-3 py-2.5">
                          <Decision value={c.actual} />
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className="mono inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold uppercase"
                            style={{ color: v.color, background: v.bg }}
                          >
                            {v.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 pr-5 text-xs text-[var(--muted)] md:pr-6">{c.detail ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        </>
      )}
    </section>
  );
}
