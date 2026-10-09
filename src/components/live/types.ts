import type { ExploitHandoffV1, RemediationResultV1 } from "@/contracts/handoff";
import type { JobEvent, JobRecord, JobStage, JobStatus } from "@/contracts/internal";

export type JobsResponse = { jobs: JobRecord[] };

export type JobDetailResponse = {
  result: RemediationResultV1 | null;
  handoff: ExploitHandoffV1 | null;
  events: JobEvent[];
};

export const STAGES: { id: JobStage; label: string; hint: string }[] = [
  { id: "queued", label: "Queued", hint: "Hand-off accepted" },
  { id: "patching", label: "Patching", hint: "AI narrows the policy" },
  { id: "simulating", label: "Simulating", hint: "Offline policy checks" },
  { id: "applying", label: "Applying", hint: "Reviewer gate + Akash deploy" },
  { id: "verifying", label: "Verifying", hint: "Replay exploit live" },
  { id: "done", label: "Done", hint: "Ship or roll back" },
];

export const STATUS_META: Record<JobStatus, { label: string; color: string; blurb: string }> = {
  in_progress: { label: "In progress", color: "var(--warn)", blurb: "Closing the loop" },
  verified: { label: "Verified", color: "var(--ok)", blurb: "Exploit blocked, legitimate access intact" },
  failed: { label: "Failed", color: "var(--danger)", blurb: "No safe patch could be proven" },
  rolled_back: { label: "Rolled back", color: "var(--danger)", blurb: "Live proof failed, previous policy restored" },
  rejected: { label: "Rejected", color: "var(--danger)", blurb: "Hand-off or proposal rejected before apply" },
};

export const SEVERITY_COLOR: Record<ExploitHandoffV1["severity"], string> = {
  critical: "var(--danger)",
  high: "#e07a5f",
  medium: "var(--warn)",
  low: "var(--ok)",
};

export function isTerminal(status: JobStatus): boolean {
  return status !== "in_progress";
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDuration(startIso: string, endIso: string | null, now: number): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : now;
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  const s = Math.max(0, Math.round((end - start) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
