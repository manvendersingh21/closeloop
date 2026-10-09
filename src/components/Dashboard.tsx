"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Finding, RemediationJob } from "@/lib/types";
import { Hero } from "./Hero";

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
  critical: "#c0392b",
  high: "#e07a5f",
  medium: "#c47a12",
  low: "#1f7a4d",
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

  function scrollToWorkspace() {
    document.getElementById("workspace")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

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
    <>
      <Hero onStart={scrollToWorkspace} />

      <section
        id="workspace"
        className="relative z-10 -mt-10 px-4 pb-20 pt-4 md:px-8"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, #eaf4fb 8%, #f4f8fc 40%, #e7f0f7 100%)",
        }}
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
          <div className="text-center md:text-left">
            <p className="eyebrow">The loop</p>
            <h2 className="display mt-2 text-3xl text-[var(--ink)] md:text-4xl">
              Pick a finding. Close it for real.
            </h2>
            <p className="mt-2 max-w-2xl text-[var(--muted)] md:text-lg">
              Triage, patch, prove with a differential PoC, then ship a CI gate
              — the missing remediation deployment layer.
            </p>
          </div>

          {/* Finding chips — interaction surface, not hero cards */}
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap">
            {findings.map((f) => {
              const active = f.id === selectedId;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(f.id);
                    setJob(null);
                    setError(null);
                  }}
                  className={`flex-1 rounded-[22px] border-2 px-5 py-4 text-left transition ${
                    active
                      ? "border-[var(--action)] bg-white shadow-[0_8px_0_#08506a]"
                      : "border-transparent bg-white/70 shadow-[0_5px_0_#b7c9d8] hover:-translate-y-0.5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="mono text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                      {f.cwe}
                    </span>
                    <span
                      className="mono text-[11px] font-bold uppercase"
                      style={{ color: SEVERITY_COLOR[f.severity] }}
                    >
                      {f.severity}
                    </span>
                  </div>
                  <div className="mt-2 text-base font-extrabold leading-snug">
                    {f.title}
                  </div>
                  <div className="mono mt-1 truncate text-xs text-[var(--muted)]">
                    {f.file}:{f.startLine}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="stage p-6 md:p-8">
            {selected ? (
              <>
                <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                  <div className="max-w-2xl">
                    <p className="eyebrow">
                      {fixture?.name || selected.fixtureId}
                    </p>
                    <h3 className="display mt-2 text-2xl leading-tight md:text-3xl">
                      {selected.title}
                    </h3>
                    <p className="mt-3 text-[var(--muted)]">{selected.message}</p>
                    <p className="mono mt-3 text-sm text-[var(--action-deep)]">
                      {selected.file}:{selected.startLine}–{selected.endLine} ·{" "}
                      {selected.ruleId}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runRemediation()}
                    className="btn-chunk btn-chunk-primary shrink-0"
                  >
                    {busy ? "Closing the loop…" : "Remediate & verify"}
                  </button>
                </div>
                {error ? (
                  <p className="mt-5 rounded-2xl border border-[#f5c2c0] bg-[#fff1f0] px-4 py-3 text-sm text-[var(--danger)]">
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
            <div className="stage overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4 md:px-6">
                <div className="flex flex-wrap gap-2">
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
                      className={`rounded-full px-4 py-2 text-sm font-bold uppercase tracking-wide transition ${
                        tab === id
                          ? "bg-[var(--ink)] text-white"
                          : "bg-white/70 text-[var(--muted)] hover:text-[var(--ink)]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span
                  className="mono text-xs font-bold uppercase tracking-[0.14em]"
                  style={{
                    color:
                      job.status === "verified"
                        ? "var(--ok)"
                        : job.status === "failed"
                          ? "var(--danger)"
                          : "var(--warn)",
                  }}
                >
                  {statusLabel(job.status)}
                </span>
              </div>
              <div className="p-5 md:p-6">
                {tab === "evidence" ? <EvidenceView job={job} /> : null}
                {tab === "diff" ? <DiffView job={job} /> : null}
                {tab === "deploy" ? <DeployView job={job} /> : null}
              </div>
            </div>
          ) : (
            <div className="stage px-6 py-10 text-center text-[var(--muted)] md:px-8">
              Hit <strong className="text-[var(--ink)]">Remediate & verify</strong>{" "}
              to generate triage, patch, PoC evidence, and a deploy package.
            </div>
          )}

          {history.length > 0 ? (
            <div className="stage overflow-hidden">
              <div className="border-b border-[var(--line)] px-5 py-4 md:px-6">
                <h3 className="display text-xl">Remediation history</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-[var(--muted)]">
                    <tr>
                      <th className="px-5 py-3 font-semibold md:px-6">Job</th>
                      <th className="px-5 py-3 font-semibold">Finding</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 font-semibold">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.slice(0, 8).map((h) => (
                      <tr key={h.id} className="border-t border-[var(--line)]">
                        <td className="mono px-5 py-3 text-xs md:px-6">
                          {h.id.slice(0, 8)}
                        </td>
                        <td className="px-5 py-3">{h.findingId}</td>
                        <td className="mono px-5 py-3 text-xs font-bold uppercase">
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
            </div>
          ) : null}

          <footer className="pt-4 text-center text-sm text-[var(--muted)] md:text-left">
            CloseLoop · Cyberdefense Hackathon #SFTechWeek · Built against the
            remediation-deployment gap in{" "}
            <em>Frontier AI&apos;s Impact on the Cybersecurity Landscape</em>{" "}
            (arXiv:2504.05408).
          </footer>
        </div>
      </section>
    </>
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
      { name: "Triage", status: "pending" as const },
      { name: "Patch", status: "pending" as const },
      { name: "Prove", status: "pending" as const },
      { name: "Regress", status: "pending" as const },
      { name: "Ship", status: "pending" as const },
    ];

  const doneCount = steps.filter((s) => s.status === "done").length;
  const progress = (doneCount / steps.length) * 100;

  return (
    <div className="stage p-5 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="display text-lg md:text-xl">Remediation pipeline</h3>
        {busy ? (
          <span className="mono text-xs font-bold uppercase tracking-widest text-[var(--warn)]">
            live
          </span>
        ) : null}
      </div>

      <div className="mb-5 h-3 overflow-hidden rounded-full bg-white/80">
        <div
          className={`h-full rounded-full bg-[var(--action)] ${job ? "pipeline-fill" : ""}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((step, i) => (
          <li
            key={`${step.name}-${i}`}
            className={`rounded-2xl px-3 py-3 ${
              step.status === "done"
                ? "bg-[color-mix(in_srgb,var(--ok)_12%,white)]"
                : step.status === "active"
                  ? "bg-[color-mix(in_srgb,var(--warn)_14%,white)]"
                  : step.status === "failed"
                    ? "bg-[color-mix(in_srgb,var(--danger)_12%,white)]"
                    : "bg-white/60"
            }`}
          >
            <div className="mono text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
              Step {i + 1}
            </div>
            <div className="mt-1 text-sm font-extrabold leading-snug">
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
    <div className="grid gap-6 lg:grid-cols-2">
      {job.triage ? (
        <div className="space-y-3">
          <h4 className="display text-base">Triage</h4>
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
          <h4 className="display text-base">Differential PoC</h4>
          <p className="text-sm text-[var(--muted)]">{job.poc.label}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#f5c2c0] bg-[#fff1f0] p-3">
              <div className="mono text-[10px] font-bold uppercase text-[var(--danger)]">
                Before · vulnerable={String(job.poc.beforeVulnerable)}
              </div>
              <pre className="mono mt-2 overflow-x-auto whitespace-pre-wrap text-xs">
                {job.poc.beforeOutput}
              </pre>
            </div>
            <div className="rounded-2xl border border-[#b7e4c7] bg-[#f0faf3] p-3">
              <div className="mono text-[10px] font-bold uppercase text-[var(--ok)]">
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
                  className="flex items-start justify-between gap-3 rounded-2xl bg-white/70 px-3 py-2 text-sm"
                >
                  <span>{r.name}</span>
                  <span
                    className="mono text-xs font-bold uppercase"
                    style={{ color: r.passed ? "var(--ok)" : "var(--danger)" }}
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
      <div className="mono text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
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
          <span className="mono ml-2 text-[11px] font-bold uppercase text-[var(--action)]">
            LLM-assisted
          </span>
        ) : null}
      </p>
      <pre className="mono max-h-[420px] overflow-auto rounded-2xl bg-[#1a2332] p-4 text-xs leading-relaxed text-[#e8efe9]">
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
        <div className="mono text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
          PR title
        </div>
        <p className="mt-1 font-extrabold">{job.deploy.prTitle}</p>
      </div>
      <div>
        <div className="mono text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
          PR body
        </div>
        <pre className="mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-2xl bg-white/80 p-3 text-xs">
          {job.deploy.prBody}
        </pre>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mono text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
            CI security gate
          </div>
          <pre className="mono mt-2 max-h-56 overflow-auto rounded-2xl bg-[#1a2332] p-3 text-xs text-[#e8efe9]">
            {job.deploy.ciGateYaml}
          </pre>
        </div>
        <div>
          <div className="mono text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
            Post-deploy verify
          </div>
          <pre className="mono mt-2 max-h-56 overflow-auto rounded-2xl bg-[#1a2332] p-3 text-xs text-[#e8efe9]">
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
