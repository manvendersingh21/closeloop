import type { ExploitHandoffV1, VerificationCheck } from "@/contracts/handoff";
import type {
  CheckResult,
  EvidenceStore,
  ExecuteAndVerify,
  JobRecord,
  PatchProposal,
} from "@/contracts/internal";
import { MAX_ATTEMPTS } from "./config";
import { proposePatch, type PatchInput } from "./patcher";
import { patchViolations } from "./policy";
import { assertLabAccount, getCurrentPolicy, simulate } from "./simulator";
import { executeAndVerify as defaultExecute, store as defaultStore } from "./wiring";

export interface OrchestratorDeps {
  store: EvidenceStore;
  executeAndVerify: ExecuteAndVerify;
  proposePatch: (input: PatchInput) => ReturnType<typeof proposePatch>;
}

export const defaultDeps: OrchestratorDeps = { store: defaultStore, executeAndVerify: defaultExecute, proposePatch };

class Rejected extends Error {}

const describe = (c: CheckResult, spec?: VerificationCheck) =>
  `check ${c.check_id}${spec ? ` (${spec.action} on ${spec.resource})` : ""} expected ${c.expected}, got ${c.actual}${
    c.detail ? ` — ${c.detail}` : ""
  }`;

export function newJob(jobId: string, findingId: string): JobRecord {
  return {
    job_id: jobId,
    finding_id: findingId,
    status: "in_progress",
    stage: "queued",
    attempt: 0,
    policy_before: null,
    policy_after: null,
    summary: [],
    rationale: "",
    exploit_before: "not_run",
    exploit_after: "not_run",
    pr_url: null,
    error: null,
    started_at: new Date().toISOString(),
    finished_at: null,
  };
}

/**
 * baseline → patch/simulate (≤ MAX_ATTEMPTS, failures fed back) → A2 executeAndVerify.
 * Live checks are recorded by the executor itself; this records baseline + simulate checks.
 */
export async function runJob(job: JobRecord, h: ExploitHandoffV1, deps: OrchestratorDeps = defaultDeps): Promise<JobRecord> {
  const { store } = deps;
  const save = (patch: Partial<JobRecord>) => store.upsertJob(Object.assign(job, patch));
  const event = (stage: string, msg: string, level?: "info" | "warn" | "error") =>
    store.recordEvent(job.job_id, stage, msg, level);
  const record = async (checks: CheckResult[]) => {
    for (const c of checks) await store.recordCheck(job.job_id, job.finding_id, c);
  };
  const specs = new Map(h.verification.checks.map((c) => [c.id, c]));
  const sid = h.target.offending_policy.statement_sid;

  try {
    await assertLabAccount(h);
    const policyBefore = await getCurrentPolicy(h);
    await save({ stage: "patching", policy_before: policyBefore });
    await event("baseline", `Loaded ${h.target.offending_policy.policy_name} on ${h.target.role_name}`);

    if (!policyBefore.Statement.some((s) => s.Sid === sid)) {
      throw new Rejected(`offending statement ${sid} not found in ${h.target.offending_policy.policy_name}`);
    }

    // The exploit must reproduce in simulation before we patch, or the hand-off doesn't match the lab.
    const negatives = h.verification.checks.filter((c) => c.expect === "deny");
    const baseline = (await simulate(h, policyBefore, negatives, "baseline", 1)).map((c) =>
      c.actual === "allow" ? { ...c, detail: "Exploit reproduced before change" } : c,
    );
    await record(baseline);
    if (baseline.some((c) => c.actual !== "allow")) {
      throw new Rejected(`exploit does not reproduce against the current policy: ${baseline.map((c) => describe(c)).join("; ")}`);
    }
    await event("baseline", "Exploit reproduces in simulator");

    let feedback: string[] | undefined;
    let proposal: PatchProposal | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !proposal; attempt++) {
      await save({ stage: "patching", attempt });
      await event("patching", `Attempt ${attempt}: requesting narrowed policy`);

      let draft;
      try {
        draft = await deps.proposePatch({ handoff: h, policyBefore, feedback });
      } catch (err) {
        feedback = [`patcher error: ${err instanceof Error ? err.message : String(err)}`];
        await event("patching", feedback[0], "warn");
        continue;
      }

      const violations = patchViolations(policyBefore, draft.policyAfter, sid);
      if (violations.length) {
        feedback = violations;
        await event("patching", `Attempt ${attempt} rejected by safety rules: ${violations.join("; ")}`, "warn");
        continue;
      }

      await save({ stage: "simulating", policy_after: draft.policyAfter, summary: draft.summary, rationale: draft.rationale });
      const simulated = await simulate(h, draft.policyAfter, h.verification.checks, "simulate", attempt);
      const failed = simulated.filter((c) => !c.passed);
      await record(simulated.map((c) => (c.passed ? c : { ...c, detail: c.detail ?? "Fed back to model" })));
      if (failed.length) {
        feedback = failed.map((c) => describe(c, specs.get(c.check_id)));
        await event("simulating", `Attempt ${attempt} failed: ${feedback.join("; ")}`, "warn");
        continue;
      }

      await event("simulating", `Attempt ${attempt} passed all ${simulated.length} checks`);
      proposal = { attempt, policyBefore, ...draft, simulated };
    }

    if (!proposal) {
      // Clear the last draft so result.change doesn't read as an applied change.
      await save({ status: "failed", stage: "done", finished_at: new Date().toISOString(),
        policy_after: null, summary: [], rationale: "",
        error: `no policy passed simulation after ${MAX_ATTEMPTS} attempts: ${(feedback ?? []).join("; ")}` });
      await event("done", job.error!, "error");
      return job;
    }

    await save({ stage: "applying" });
    await event("applying", "Handing simulated policy to executor");
    const report = await deps.executeAndVerify(h, proposal, job.job_id);
    await save({
      status: report.status,
      stage: "done",
      exploit_before: report.exploitBefore,
      exploit_after: report.exploitAfter,
      pr_url: report.prUrl ?? null,
      error: report.error,
      finished_at: new Date().toISOString(),
    });
    await event("done", `Job ${report.status}; exploit after: ${report.exploitAfter}`, report.status === "verified" ? "info" : "warn");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await save({ status: err instanceof Rejected ? "rejected" : "failed", stage: "done", error: msg, finished_at: new Date().toISOString() });
    await event("done", msg, "error");
  }
  return job;
}
