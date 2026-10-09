// Internal contract between A1 (brain: ingest, patcher, simulator, orchestrator)
// and A2 (hands: executor, evidence store, result API, PR, UI).
// Change only with both owners' sign-off.
import type { ExploitHandoffV1, RemediationResultV1 } from "./handoff";

export type PolicyStatement = {
  Sid?: string;
  Effect: "Allow" | "Deny";
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, unknown>;
};

export type PolicyDocument = {
  Version: "2012-10-17";
  Statement: PolicyStatement[];
};

export type CheckResult = RemediationResultV1["checks"][number];
export type JobStatus = RemediationResultV1["status"];
export type JobStage = RemediationResultV1["stage"];
export type ReplayOutcome = RemediationResultV1["exploit_replay"]["before"];

/** A1 → A2: a policy that already passed every check in the IAM simulator. */
export interface PatchProposal {
  attempt: number;
  policyBefore: PolicyDocument;
  policyAfter: PolicyDocument;
  summary: string[];
  rationale: string;
  simulated: CheckResult[];
}

/** A2 → A1: outcome of applying a proposal to the lab and proving it live. */
export interface ExecutionReport {
  status: "verified" | "rolled_back" | "failed";
  checks: CheckResult[];
  exploitBefore: ReplayOutcome;
  exploitAfter: ReplayOutcome;
  error: string | null;
  /** Set when a verified fix was shipped as a pull request. */
  prUrl?: string | null;
  /** Guild session link of the independent review, for the audit trail. */
  reviewSessionUrl?: string | null;
}

/** Independent AI review of a proposal (a Guild-hosted agent) before anything is applied. */
export interface ReviewVerdict {
  /** "unavailable" = reviewer down or timed out; the deterministic gate still decides. */
  decision: "approve" | "reject" | "unavailable";
  reasons: string[];
  sessionUrl: string | null;
}

export type ReviewProposal = (
  handoff: ExploitHandoffV1,
  proposal: PatchProposal,
  jobId: string,
) => Promise<ReviewVerdict>;

/** Ships a verified fix (pull request with the policy diff and evidence). Never throws. */
export interface ShipResult {
  prUrl: string | null;
  error: string | null;
}

export type ShipFix = (input: {
  handoff: ExploitHandoffV1;
  proposal: PatchProposal;
  report: ExecutionReport;
  jobId: string;
  review: ReviewVerdict | null;
}) => Promise<ShipResult>;

/** Implemented by A2 in src/lib/remediate/executor.ts; called by A1's orchestrator. */
export type ExecuteAndVerify = (
  handoff: ExploitHandoffV1,
  proposal: PatchProposal,
  jobId: string,
) => Promise<ExecutionReport>;

/** Row shape for the jobs table. Every upsert writes the full row. */
export interface JobRecord {
  job_id: string;
  finding_id: string;
  status: JobStatus;
  stage: JobStage;
  attempt: number;
  policy_before: PolicyDocument | null;
  policy_after: PolicyDocument | null;
  summary: string[];
  rationale: string;
  exploit_before: ReplayOutcome;
  exploit_after: ReplayOutcome;
  pr_url: string | null;
  error: string | null;
  started_at: string; // ISO 8601
  finished_at: string | null;
}

export interface JobEvent {
  ts: string;
  stage: string;
  level: "info" | "warn" | "error";
  message: string;
}

/** Implemented by A2 in src/lib/evidence-store.ts; A1 calls it throughout a job. */
export interface EvidenceStore {
  saveHandoff(handoff: ExploitHandoffV1): Promise<void>;
  getHandoff(findingId: string): Promise<ExploitHandoffV1 | null>;
  upsertJob(job: JobRecord): Promise<void>;
  getJob(jobId: string): Promise<JobRecord | null>;
  /** Latest job for a finding, for ingest idempotency (200/409). */
  findLatestJobForFinding(findingId: string): Promise<JobRecord | null>;
  listJobs(limit?: number): Promise<JobRecord[]>;
  recordCheck(jobId: string, findingId: string, check: CheckResult): Promise<void>;
  getChecks(jobId: string): Promise<CheckResult[]>;
  recordEvent(jobId: string, stage: string, message: string, level?: JobEvent["level"]): Promise<void>;
  getEvents(jobId: string): Promise<JobEvent[]>;
}
