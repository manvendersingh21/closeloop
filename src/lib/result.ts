import { RemediationResultV1, type RemediationResultV1 as RemediationResult } from "@/contracts/handoff";
import { evidenceStore } from "@/lib/evidence-store";

/** Assemble a remediation-result/v1 for a job from the evidence store.
 *  Returns null when the job does not exist. */
export async function buildResult(jobId: string): Promise<RemediationResult | null> {
  const job = await evidenceStore.getJob(jobId);
  if (!job) return null;

  const [checks, handoff] = await Promise.all([
    evidenceStore.getChecks(jobId),
    evidenceStore.getHandoff(job.finding_id),
  ]);

  const result = {
    schema_version: "remediation-result/v1" as const,
    job_id: job.job_id,
    finding_id: job.finding_id,
    status: job.status,
    stage: job.stage,
    attempts: job.attempt,
    change:
      job.policy_after === null
        ? null
        : {
            type: "iam_inline_policy" as const,
            role_name: handoff?.target.role_name ?? "",
            policy_name: handoff?.target.offending_policy.policy_name ?? "",
            before: job.policy_before ?? {},
            after: job.policy_after,
            summary: job.summary,
          },
    checks,
    exploit_replay: {
      before: job.exploit_before,
      after: job.exploit_after,
    },
    rationale: job.rationale,
    pr_url: job.pr_url,
    error: job.error,
    started_at: job.started_at,
    finished_at: job.finished_at,
  };

  return RemediationResultV1.parse(result);
}
