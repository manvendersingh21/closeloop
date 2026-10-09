// A2 executor for the Akash lab: apply the simulated policy, wait until the
// lab is actually enforcing it, prove it live, and roll back if the app breaks.
import { isDeepStrictEqual } from "node:util";
import type { ExploitHandoffV1, VerificationCheck } from "@/contracts/handoff";
import type {
  CheckResult,
  EvidenceStore,
  ExecuteAndVerify,
  ExecutionReport,
  PolicyDocument,
  ReplayOutcome,
} from "@/contracts/internal";
import { akashClient, type AkashClient } from "@/lib/akash";
import { evidenceStore } from "@/lib/evidence-store";
import { fetchLivePolicy, labRequest, resolveLabTarget, toLabPolicy, type LabTarget } from "@/lib/lab";

export interface ExecutorDeps {
  akash: AkashClient;
  store: EvidenceStore;
  resolveTarget: (h: ExploitHandoffV1) => LabTarget;
  /** Times each live check is repeated; every repetition must pass. */
  repeats: number;
  /** How long to wait for Akash to roll out a new policy. */
  rolloutTimeoutMs: number;
  pollIntervalMs: number;
}

export const defaultExecutorDeps: ExecutorDeps = {
  akash: akashClient,
  store: evidenceStore,
  resolveTarget: resolveLabTarget,
  repeats: Number(process.env.CLOSELOOP_LIVE_REPEATS || 3),
  rolloutTimeoutMs: Number(process.env.CLOSELOOP_ROLLOUT_TIMEOUT_MS || 240_000),
  pollIntervalMs: 3_000,
};

type Phase = "baseline" | "live" | "rollback";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Status → decision. 401 means our token is wrong, which proves nothing either way. */
function decide(status: number): "allow" | "deny" | "error" {
  if (status === 403) return "deny";
  if (status >= 200 && status < 300) return "allow";
  if (status === 404) return "allow"; // authorization passed; the object just isn't there
  return "error";
}

async function runCheck(t: LabTarget, c: VerificationCheck, phase: Phase, attempt: number, repeats: number): Promise<CheckResult> {
  const req = labRequest(c);
  const base = { check_id: c.id, phase, attempt, expected: c.expect };
  if (!req) return { ...base, actual: "error", passed: false, detail: `no lab route for ${c.action} on ${c.resource}` };

  const statuses: number[] = [];
  let actual: CheckResult["actual"] = c.expect;
  for (let i = 0; i < repeats; i++) {
    try {
      const res = await fetch(t.baseUrl + req.path, {
        method: req.method,
        headers: { authorization: `Bearer ${t.token}` },
        signal: AbortSignal.timeout(10_000),
      });
      statuses.push(res.status);
      const d = decide(res.status);
      if (d !== c.expect) actual = d;
    } catch (err) {
      statuses.push(0);
      actual = "error";
      return { ...base, actual, passed: false, detail: `${req.method} ${req.path}: ${err instanceof Error ? err.message : err}` };
    }
  }
  return { ...base, actual, passed: actual === c.expect, detail: `${req.method} ${req.path} → ${statuses.join(", ")}` };
}

export function createExecutor(deps: ExecutorDeps = defaultExecutorDeps): ExecuteAndVerify {
  return async (h, proposal, jobId): Promise<ExecutionReport> => {
    const { store, akash, repeats } = deps;
    const event = (stage: string, msg: string, level?: "info" | "warn" | "error") =>
      store.recordEvent(jobId, stage, msg, level);
    const record = async (checks: CheckResult[]) => {
      for (const c of checks) await store.recordCheck(jobId, h.finding_id, c);
    };
    const runAll = (phase: Phase, checks = h.verification.checks) =>
      Promise.all(checks.map((c) => runCheck(t, c, phase, proposal.attempt, repeats)));

    const replay: VerificationCheck = {
      id: "exploit-replay",
      kind: "negative",
      action: h.exploit.replay.action,
      resource: h.exploit.replay.resource,
      expect: "deny",
    };
    const replayOutcome = (c: CheckResult): ReplayOutcome =>
      c.actual === "allow" ? "success" : c.actual === "deny" ? "blocked" : "not_run";

    const report: ExecutionReport = {
      status: "failed",
      checks: [],
      exploitBefore: "not_run",
      exploitAfter: "not_run",
      error: null,
    };

    let t: LabTarget;
    try {
      t = deps.resolveTarget(h);
    } catch (err) {
      report.error = err instanceof Error ? err.message : String(err);
      await event("applying", report.error, "error");
      return report;
    }

    // True from the moment we send any change until the original is confirmed live again.
    let dirty = false;
    const apply = async (policy: PolicyDocument, label: string) => {
      const want = toLabPolicy(policy);
      dirty = true;
      await akash.patchServiceEnv(t.dseq, t.service, { [t.policyEnvVar]: JSON.stringify(want) });
      await event("applying", `Sent ${label} policy to Akash deployment ${t.dseq} (${t.service})`);
      const deadline = Date.now() + deps.rolloutTimeoutMs;
      while (Date.now() < deadline) {
        try {
          if (isDeepStrictEqual(await fetchLivePolicy(t), want)) {
            await event("applying", `Lab is enforcing the ${label} policy`);
            if (policy === proposal.policyBefore) dirty = false;
            return;
          }
        } catch {
          // container restarting; keep polling
        }
        await sleep(deps.pollIntervalMs);
      }
      throw new Error(`Akash did not roll out the ${label} policy within ${Math.round(deps.rolloutTimeoutMs / 1000)}s`);
    };

    try {
      // Baseline: the exploit must work live before we change anything.
      const [before] = await runAll("baseline", [replay]);
      before.detail = `${before.detail ?? ""}${before.actual === "allow" ? " — exploit reproduced live" : ""}`.trim();
      await record([before]);
      report.checks.push(before);
      report.exploitBefore = replayOutcome(before);
      if (report.exploitBefore !== "success") {
        report.error = `exploit did not reproduce live before the change (${before.detail})`;
        await event("verifying", report.error, "error");
        return report;
      }
      await event("verifying", "Exploit reproduces against the live lab");

      await apply(proposal.policyAfter, "patched");

      await event("verifying", `Running ${h.verification.checks.length} live checks ×${repeats}`);
      const live = await runAll("live");
      const [after] = await runAll("live", [replay]);
      await record([...live, after]);
      report.checks.push(...live, after);
      report.exploitAfter = replayOutcome(after);

      const failed = [...live, after].filter((c) => !c.passed);
      if (!failed.length) {
        report.status = "verified";
        await event("verifying", "Canary blocked and every legitimate check still passes");
        return report;
      }

      const names = failed.map((c) => `${c.check_id} (${c.detail})`).join("; ");
      await event("verifying", `Live verification failed: ${names}. Rolling back`, "warn");
      await apply(proposal.policyBefore, "original");
      const restored = await runAll("rollback", h.verification.checks.filter((c) => c.kind !== "negative"));
      await record(restored);
      report.checks.push(...restored);
      report.status = "rolled_back";
      report.error = `live verification failed: ${names}`;
      await event("rollback", `Original policy restored; ${restored.filter((c) => c.passed).length}/${restored.length} app checks pass`);
      return report;
    } catch (err) {
      report.error = err instanceof Error ? err.message : String(err);
      await event("applying", report.error, "error");
      if (dirty) {
        // The patched policy may be live in an unverified state: put the original back.
        try {
          await apply(proposal.policyBefore, "original");
          report.status = "rolled_back";
          await event("rollback", "Original policy restored after an execution error");
        } catch (rollbackErr) {
          const msg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
          report.error += `; ROLLBACK FAILED: ${msg}`;
          await event("rollback", `Rollback failed: ${msg}. Restore the policy manually in Akash Console`, "error");
        }
      }
      return report;
    }
  };
}

export const executeAndVerify: ExecuteAndVerify = createExecutor();
