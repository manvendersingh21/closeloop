"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Finding, RemediationJob } from "@/lib/types";

type FixtureMeta = {
  id: string;
  name: string;
  description: string;
  entryFile: string;
  findingId: string;
};

type FindingsResponse = {
  findings: Finding[];
  fixtures: FixtureMeta[];
};

const SEVERITY_COLOR: Record<Finding["severity"], string> = {
  critical: "#9f1239",
  high: "#c2410c",
  medium: "#b45309",
  low: "#3f6212",
};

function statusLabel(status: RemediationJob["status"]) {
  if (status === "verified") return "VERIFIED";
  if (status === "failed") return "FAILED";
  if (status === "pending") return "QUEUED";
  return status.toUpperCase();
}

export function Dashboard() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [fixtures, setFixtures] = useState<FixtureMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [job, setJob] = useState<RemediationJob | null>(null);
  const [history, setHistory] = useState<RemediationJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"evidence" | "diff" | "deploy">("evidence");

  const selected = useMemo(
    () => findings.find((f) => f.id === selectedId) || null,
    [findings, selectedId],
  );

  const fixture = useMemo(
    () => fixtures.find((f) => f.findingId === selectedId) || null,
    [fixtures, selectedId],
  );

  const load = useCallback(async () => {
    const [fRes, jRes] = await Promise.all([
      fetch("/api/findings"),
      fetch("/api/jobs"),
    ]);
    const fData = (await fRes.json()) as FindingsResponse;
    const jData = (await jRes.json()) as { jobs: RemediationJob[] };
    setFindings(fData.findings);
    setFixtures(fData.fixtures);
    setHistory(jData.jobs);
    if (!selectedId && fData.findings[0]) {
      setSelectedId(fData.findings[0].id);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runRemediation() {
    if (!selectedId || busy) return;
    setBusy(true);
    setError(null);
    setTab("evidence");
    try {
      const res = await fetch("/api/remediate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId: selectedId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Remediation failed");
      setJob(data.job as RemediationJob);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 pb-16 pt-6 md:px-8">
      <header className="animate-rise flex flex-col gap-6 border-b border-[var(--line)] pb-8 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <div className="badge mb-4 text-[var(--teal-deep)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--teal)]" />
            Cyberdefense Hackathon · Autonomous Remediation
          </div>
          <h1 className="display text-5xl font-extrabold leading-[0.95] text-[var(--ink)] md:text-6xl">
            CloseLoop
          </h1>
          <p className="mt-3 max-w-xl text-lg text-[var(--muted)]">
            Find. Fix. Prove. Ship. — the missing remediation deployment layer.
            AI patches don&apos;t count until the exploit is closed.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <div className="mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            Survey gap · Rem. Dep. = 0
          </div>
          <div className="h-1 w-40 bg-[var(--teal)] scan-line" />
          <p className="max-w-xs text-right text-sm text-[var(--muted)]">
            Verified before merge. Proven after deploy.
          </p>
        </div>
      </header>

      <section className="animate-rise-delay-1 grid gap-6 lg:grid-cols-[340px_1fr]">
        <aside className="panel flex flex-col overflow-hidden">
          <div className="border-b border-[var(--line)] px-5 py-4">
            <h2 className="display text-xl font-bold">Open findings</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Semgrep-style fixtures ready for verified remediation.
            </p>
          </div>
          <ul className="flex flex-col">
            {findings.map((f) => {
              const active = f.id === selectedId;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(f.id);
                      setJob(null);
                      setError(null);
                    }}
                    className={`w-full border-b border-[var(--line)] px-5 py-4 text-left transition ${
                      active
                        ? "bg-[color-mix(in_srgb,var(--teal)_10%,white)]"
                        : "hover:bg-white/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="mono text-[11px] uppercase tracking-wider text-[var(--muted)]">
                        {f.cwe}
                      </span>
                      <span
                        className="mono text-[11px] uppercase"
                        style={{ color: SEVERITY_COLOR[f.severity] }}
                      >
                        {f.severity}
                      </span>
                    </div>
                    <div className="mt-1 font-semibold leading-snug">{f.title}</div>
                    <div className="mono mt-1 truncate text-xs text-[var(--muted)]">
                      {f.file}:{f.startLine}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="flex flex-col gap-6">
          <div className="panel p-6">
            {selected ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="badge mb-3">
                      {fixture?.name || selected.fixtureId}
                    </div>
                    <h2 className="display text-3xl font-bold leading-tight">
                      {selected.title}
                    </h2>
                    <p className="mt-2 max-w-2xl text-[var(--muted)]">
                      {selected.message}
                    </p>
                    <p className="mono mt-3 text-sm text-[var(--teal-deep)]">
                      {selected.file}:{selected.startLine}–{selected.endLine} ·{" "}
                      {selected.ruleId}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runRemediation()}
                    className="display rounded-sm bg-[var(--teal)] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[var(--teal-deep)] disabled:cursor-wait disabled:opacity-60"
                  >
                    {busy ? "Closing the loop…" : "Remediate & verify"}
                  </button>
                </div>
                {error ? (
                  <p className="mt-4 border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-sm text-[#9f1239]">
                    {error}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-[var(--muted)]">Loading findings…</p>
            )}
          </div>

          <PipelinePanel job={job} busy={busy} />

          {job ? (
            <div className="panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3">
                <div className="flex gap-2">
                  {(
                    [
                      ["evidence", "Evidence"],
                      ["diff", "Patch diff"],
                      ["deploy", "Deploy package"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={`px-3 py-1.5 text-sm font-semibold ${
                        tab === id
                          ? "bg-[var(--ink)] text-[var(--bg)]"
                          : "text-[var(--muted)] hover:text-[var(--ink)]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span
                  className="mono text-xs font-medium uppercase tracking-[0.14em]"
                  style={{
                    color:
                      job.status === "verified"
                        ? "var(--ok)"
                        : job.status === "failed"
                          ? "var(--coral)"
                          : "var(--amber)",
                  }}
                >
                  {statusLabel(job.status)}
                </span>
              </div>
              <div className="p-5">
                {tab === "evidence" ? <EvidenceView job={job} /> : null}
                {tab === "diff" ? <DiffView job={job} /> : null}
                {tab === "deploy" ? <DeployView job={job} /> : null}
              </div>
            </div>
          ) : (
            <div className="panel animate-rise-delay-2 p-8 text-[var(--muted)]">
              Run a remediation to generate triage, patch, differential PoC
              evidence, and a deployable CI gate.
            </div>
          )}
        </div>
      </section>

      {history.length > 0 ? (
        <section className="panel overflow-hidden">
          <div className="border-b border-[var(--line)] px-5 py-4">
            <h2 className="display text-xl font-bold">Remediation history</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-[var(--line)] text-[var(--muted)]">
                <tr>
                  <th className="px-5 py-3 font-medium">Job</th>
                  <th className="px-5 py-3 font-medium">Finding</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 8).map((h) => (
                  <tr key={h.id} className="border-b border-[var(--line)]">
                    <td className="mono px-5 py-3 text-xs">{h.id.slice(0, 8)}</td>
                    <td className="px-5 py-3">{h.findingId}</td>
                    <td className="mono px-5 py-3 text-xs uppercase">
                      {h.status}
                    </td>
                    <td className="px-5 py-3 text-[var(--muted)]">
                      {new Date(h.updatedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PipelinePanel({
  job,
  busy,
}: {
  job: RemediationJob | null;
  busy: boolean;
}) {
  const steps =
    job?.steps ||
    [
      { name: "Triage root cause", status: "pending" as const },
      { name: "Generate security patch", status: "pending" as const },
      { name: "Prove with differential PoC", status: "pending" as const },
      { name: "Run regression suite", status: "pending" as const },
      { name: "Package deployment + CI gate", status: "pending" as const },
    ];

  return (
    <div className="panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="display text-lg font-bold">Remediation pipeline</h3>
        {busy ? (
          <span className="mono text-xs uppercase tracking-widest text-[var(--amber)]">
            live
          </span>
        ) : null}
      </div>
      <ol className="grid gap-3 md:grid-cols-5">
        {steps.map((step, i) => (
          <li
            key={step.name}
            className={`border border-[var(--line)] p-3 ${
              step.status === "done"
                ? "bg-[color-mix(in_srgb,var(--ok)_8%,white)]"
                : step.status === "active"
                  ? "bg-[color-mix(in_srgb,var(--amber)_10%,white)]"
                  : step.status === "failed"
                    ? "bg-[color-mix(in_srgb,var(--coral)_10%,white)]"
                    : "bg-white/40"
            }`}
          >
            <div className="mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
              Step {i + 1}
            </div>
            <div className="mt-1 text-sm font-semibold leading-snug">
              {step.name}
            </div>
            <div className="mono mt-2 text-[11px] uppercase text-[var(--muted)]">
              {step.status}
              {step.detail ? ` · ${step.detail}` : ""}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EvidenceView({ job }: { job: RemediationJob }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {job.triage ? (
        <div className="space-y-3">
          <h4 className="display text-base font-bold">Triage</h4>
          <EvidenceRow label="Root cause" value={job.triage.rootCause} />
          <EvidenceRow label="Attack path" value={job.triage.attackPath} />
          <EvidenceRow label="Blast radius" value={job.triage.blastRadius} />
          <EvidenceRow
            label="Confidence"
            value={`${(job.triage.confidence * 100).toFixed(0)}%`}
          />
        </div>
      ) : null}
      {job.poc ? (
        <div className="space-y-3">
          <h4 className="display text-base font-bold">Differential PoC</h4>
          <p className="text-sm text-[var(--muted)]">{job.poc.label}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-[#fecaca] bg-[#fff1f2] p-3">
              <div className="mono text-[10px] uppercase text-[#9f1239]">
                Before · vulnerable={String(job.poc.beforeVulnerable)}
              </div>
              <pre className="mono mt-2 overflow-x-auto whitespace-pre-wrap text-xs">
                {job.poc.beforeOutput}
              </pre>
            </div>
            <div className="border border-[#bbf7d0] bg-[#f0fdf4] p-3">
              <div className="mono text-[10px] uppercase text-[#166534]">
                After · secure={String(job.poc.afterSecure)}
              </div>
              <pre className="mono mt-2 overflow-x-auto whitespace-pre-wrap text-xs">
                {job.poc.afterOutput}
              </pre>
            </div>
          </div>
          {job.regressions ? (
            <ul className="space-y-2">
              {job.regressions.map((r) => (
                <li
                  key={r.name}
                  className="flex items-start justify-between gap-3 border border-[var(--line)] px-3 py-2 text-sm"
                >
                  <span>{r.name}</span>
                  <span
                    className="mono text-xs uppercase"
                    style={{ color: r.passed ? "var(--ok)" : "var(--coral)" }}
                  >
                    {r.passed ? "pass" : "fail"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
        {label}
      </div>
      <p className="mt-1 text-sm leading-relaxed">{value}</p>
    </div>
  );
}

function DiffView({ job }: { job: RemediationJob }) {
  if (!job.patch) return <p className="text-[var(--muted)]">No patch yet.</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted)]">
        {job.patch.rationale}
        {job.patch.llmAssisted ? (
          <span className="mono ml-2 text-[11px] uppercase text-[var(--teal)]">
            LLM-assisted
          </span>
        ) : null}
      </p>
      <pre className="mono max-h-[420px] overflow-auto border border-[var(--line)] bg-[#1a1f1c] p-4 text-xs leading-relaxed text-[#e8efe9]">
        {job.patch.unifiedDiff}
      </pre>
    </div>
  );
}

function DeployView({ job }: { job: RemediationJob }) {
  if (!job.deploy) return <p className="text-[var(--muted)]">No package yet.</p>;
  return (
    <div className="space-y-5">
      <div>
        <div className="mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
          PR title
        </div>
        <p className="mt-1 font-semibold">{job.deploy.prTitle}</p>
      </div>
      <div>
        <div className="mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
          PR body
        </div>
        <pre className="mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap border border-[var(--line)] bg-white/70 p-3 text-xs">
          {job.deploy.prBody}
        </pre>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
            CI security gate
          </div>
          <pre className="mono mt-2 max-h-56 overflow-auto border border-[var(--line)] bg-[#1a1f1c] p-3 text-xs text-[#e8efe9]">
            {job.deploy.ciGateYaml}
          </pre>
        </div>
        <div>
          <div className="mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Post-deploy verify
          </div>
          <pre className="mono mt-2 max-h-56 overflow-auto border border-[var(--line)] bg-[#1a1f1c] p-3 text-xs text-[#e8efe9]">
            {job.deploy.verifyScript}
          </pre>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
            {job.deploy.rolloutNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
