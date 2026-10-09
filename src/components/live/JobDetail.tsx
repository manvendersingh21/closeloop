"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChecksTable } from "./ChecksTable";
import { ExploitBanner } from "./ExploitBanner";
import { guildUrls } from "./links";
import { PolicyDiff } from "./PolicyDiff";
import { reviewFromEvents, shipFromEvents } from "./review";
import { ReviewCard, ShipLine } from "./ReviewCard";
import { StageStepper } from "./StageStepper";
import { LiveDot, StatusPill } from "./StatusPill";
import { Timeline } from "./Timeline";
import { SEVERITY_COLOR, STATUS_META, formatDuration, formatTime, isTerminal, type JobDetailResponse } from "./types";
import { usePoll } from "./usePoll";

const stopWhenTerminal = (d: JobDetailResponse) => (d.result ? isTerminal(d.result.status) : false);

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mono text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className="mono mt-0.5 truncate text-xs tabular-nums">{value}</div>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading job" className="flex flex-col gap-6">
      <div className="stage space-y-3 p-6 md:p-8">
        <div className="cl-skel h-3 w-40" />
        <div className="cl-skel h-8 w-3/4" />
        <div className="cl-skel h-4 w-1/2" />
      </div>
      <div className="cl-skel h-28 w-full rounded-[var(--radius-stage)]" />
      <div className="cl-skel h-44 w-full rounded-[var(--radius-stage)]" />
      <div className="cl-skel h-64 w-full rounded-[var(--radius-stage)]" />
    </div>
  );
}

export function JobDetail({ jobId }: { jobId: string }) {
  const { data, httpStatus, stale, lastUpdated } = usePoll<JobDetailResponse>(
    `/api/live/jobs/${encodeURIComponent(jobId)}`,
    2000,
    stopWhenTerminal,
  );

  if (httpStatus === 404 || (data && !data.result)) {
    return (
      <section className="stage px-6 py-14 text-center md:px-10">
        <p className="eyebrow">404</p>
        <h1 className="display mt-2 text-2xl md:text-3xl">Job not found</h1>
        <p className="mono mx-auto mt-2 max-w-md break-all text-sm text-[var(--muted)]">{jobId}</p>
        <Link href="/jobs" className="btn-chunk btn-chunk-secondary mt-7">
          Back to jobs
        </Link>
      </section>
    );
  }

  if (!data?.result) {
    if (httpStatus !== null && httpStatus !== 200) {
      return (
        <section className="stage px-6 py-14 text-center">
          <h1 className="display text-2xl">Can&apos;t load this job right now</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            HTTP {httpStatus || "network error"} from the evidence store. Retrying every 2s.
          </p>
        </section>
      );
    }
    return <DetailSkeleton />;
  }

  const { result, handoff, events } = data;
  const live = !isTerminal(result.status);
  const meta = STATUS_META[result.status];
  const review = reviewFromEvents(events);
  const ship = shipFromEvents(events);
  const guild = guildUrls(events.map((e) => e.message)).filter((u) => u !== review?.sessionUrl);
  const prUrl = result.pr_url ?? ship?.prUrl ?? null;
  const severity = handoff?.severity;

  return (
    <>
      <section className="stage p-6 md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <p className="eyebrow flex flex-wrap items-center gap-x-2">
              <span>{result.finding_id}</span>
              {severity ? (
                <span className="mono font-bold" style={{ color: SEVERITY_COLOR[severity] }}>
                  · {severity}
                </span>
              ) : null}
              {handoff?.vulnerability.cwe ? <span>· {handoff.vulnerability.cwe}</span> : null}
            </p>
            <h1 className="display mt-2 text-2xl leading-tight md:text-3xl">
              {handoff?.title ?? `Remediation for ${result.finding_id}`}
            </h1>
            {handoff ? (
              <p className="mt-3 text-[var(--muted)]">{handoff.vulnerability.description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
            <StatusPill status={result.status} size="lg" />
            <p className="text-sm text-[var(--muted)] lg:text-right">{meta?.blurb}</p>
            <LiveDot live={live} stale={stale} />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--line)] pt-5 sm:grid-cols-3 lg:grid-cols-6">
          <Meta label="Job" value={result.job_id} />
          <Meta label="Target" value={handoff?.target.role_name ?? "—"} />
          <Meta
            label="Akash"
            value={handoff?.akash ? `${handoff.akash.service} · ${handoff.akash.dseq}` : "—"}
          />
          <Meta label="Attempts" value={result.attempts} />
          <Meta label="Started" value={formatTime(result.started_at)} />
          <Meta
            label={live ? "Elapsed" : "Took"}
            value={formatDuration(result.started_at, result.finished_at, lastUpdated ?? Date.parse(result.started_at))}
          />
        </div>

        {result.error ? (
          <p
            className="mt-5 break-words rounded-2xl border px-4 py-3 text-sm"
            style={{
              color: "var(--danger)",
              background: "var(--cl-bad-bg)",
              borderColor: "color-mix(in srgb, var(--danger) 35%, transparent)",
            }}
          >
            {result.error}
          </p>
        ) : null}

        {ship ? (
          <div className="mt-5">
            <ShipLine ship={ship} />
          </div>
        ) : null}

        {prUrl || guild.length > 0 ? (
          <div className="mt-5 flex flex-wrap gap-3">
            {prUrl ? (
              <a href={prUrl} target="_blank" rel="noreferrer" className="btn-chunk btn-chunk-primary">
                Pull request ↗
              </a>
            ) : null}
            {guild.map((u, i) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" className="btn-chunk btn-chunk-secondary">
                Guild review session{guild.length > 1 ? ` ${i + 1}` : ""} ↗
              </a>
            ))}
          </div>
        ) : null}
      </section>

      {review ? <ReviewCard review={review} /> : null}

      <ExploitBanner
        before={result.exploit_replay.before}
        after={result.exploit_replay.after}
        live={live}
        rolledBack={result.status === "rolled_back"}
        replayAction={handoff?.exploit.replay.action}
        replayResource={handoff?.exploit.replay.resource}
      />

      <StageStepper stage={result.stage} status={result.status} events={events} />

      <PolicyDiff change={result.change} rationale={result.rationale} live={live} />

      <ChecksTable checks={result.checks} live={live} />

      <Timeline events={events} live={live} />
    </>
  );
}
