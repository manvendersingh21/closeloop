"use client";

import Link from "next/link";
import { LiveDot, StatusPill } from "./StatusPill";
import { STAGES, formatTime, type JobsResponse } from "./types";
import { usePoll } from "./usePoll";

const COLS = "md:grid-cols-[1.3fr_1fr_0.9fr_0.6fr_1.2fr_1.5rem]";

export function JobsList() {
  const { data, httpStatus, stale } = usePoll<JobsResponse>("/api/live/jobs", 3000);
  const jobs = data?.jobs ?? null;
  const failedFirstLoad = jobs === null && httpStatus !== null && httpStatus !== 200;

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Live remediation</p>
          <h1 className="display mt-2 text-3xl md:text-4xl">Jobs</h1>
          <p className="mt-2 max-w-2xl text-[var(--muted)]">
            Each job starts from a validated hand-off: AI narrows the policy, a reviewer agent signs off, the patch is
            proven offline, applied to the live Akash lab, and the real exploit is replayed until it is blocked.
          </p>
        </div>
        <LiveDot live={!failedFirstLoad} stale={stale || failedFirstLoad} />
      </div>

      <section className="stage overflow-hidden">
        <div
          className={`mono hidden gap-4 border-b border-[var(--line)] px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] md:grid ${COLS}`}
        >
          <span>Finding</span>
          <span>Status</span>
          <span>Stage</span>
          <span>Attempts</span>
          <span>Started</span>
          <span />
        </div>

        {jobs === null && !failedFirstLoad ? (
          <ul aria-busy="true" aria-label="Loading jobs">
            {[0, 1, 2].map((i) => (
              <li key={i} className="border-t border-[var(--line)] px-5 py-4 first:border-t-0 md:px-6">
                <div className="cl-skel h-6 w-full" />
              </li>
            ))}
          </ul>
        ) : null}

        {failedFirstLoad ? (
          <p className="px-6 py-10 text-center text-[var(--muted)]">
            Could not reach the evidence store (HTTP {httpStatus || "network error"}). Retrying every 3s.
          </p>
        ) : null}

        {jobs && jobs.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="display text-lg">No jobs yet</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              POST an exploit hand-off to <span className="mono">/api/handoffs</span> and it will appear here.
            </p>
          </div>
        ) : null}

        {jobs && jobs.length > 0 ? (
          <ul>
            {jobs.map((j) => {
              const stageIdx = STAGES.findIndex((s) => s.id === j.stage);
              return (
                <li key={j.job_id} className="border-t border-[var(--line)] first:border-t-0">
                  <Link
                    href={`/jobs/${encodeURIComponent(j.job_id)}`}
                    className={`grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-4 transition hover:bg-[var(--cl-well)] md:gap-4 md:px-6 ${COLS}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-extrabold">{j.finding_id}</span>
                      <span className="mono block truncate text-[11px] text-[var(--muted)]">{j.job_id}</span>
                    </span>
                    <span className="justify-self-end md:justify-self-start">
                      <StatusPill status={j.status} />
                    </span>
                    <span className="mono text-xs uppercase text-[var(--muted)]">
                      <span className="md:hidden">Stage </span>
                      {j.stage}
                      <span className="text-[var(--line)]"> · </span>
                      {stageIdx + 1}/{STAGES.length}
                    </span>
                    <span className="mono justify-self-end text-xs text-[var(--muted)] md:justify-self-start">
                      <span className="md:hidden">Attempts </span>
                      {j.attempt}
                    </span>
                    <span className="mono col-span-2 text-xs text-[var(--muted)] md:col-span-1">
                      {formatTime(j.started_at)}
                    </span>
                    <span aria-hidden className="hidden text-[var(--muted)] md:block">
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </>
  );
}
