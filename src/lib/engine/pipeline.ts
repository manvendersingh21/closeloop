import { randomUUID } from "crypto";
import type { Finding, RemediationJob } from "../types";
import { getFinding } from "../fixtures";
import { saveJob } from "../store";
import { triageFinding } from "./triage";
import { generatePatch } from "./patch";
import { isVerified, runPoc, runRegressions } from "./poc";
import { buildDeployPackage } from "./deploy";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function baseSteps(): RemediationJob["steps"] {
  return [
    { name: "Triage root cause", status: "pending" },
    { name: "Generate security patch", status: "pending" },
    { name: "Prove with differential PoC", status: "pending" },
    { name: "Run regression suite", status: "pending" },
    { name: "Package deployment + CI gate", status: "pending" },
  ];
}

async function persist(job: RemediationJob) {
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  return job;
}

export async function createAndRunRemediation(
  findingId: string,
  opts?: { delayMs?: number },
): Promise<RemediationJob> {
  const finding = getFinding(findingId);
  if (!finding) throw new Error(`Unknown finding: ${findingId}`);

  const delay = opts?.delayMs ?? 350;
  const now = new Date().toISOString();
  const job: RemediationJob = {
    id: randomUUID(),
    findingId,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    steps: baseSteps(),
  };
  await persist(job);

  try {
    // 1. Triage
    job.status = "triaging";
    job.steps[0] = { ...job.steps[0], status: "active" };
    await persist(job);
    await sleep(delay);
    job.triage = triageFinding(finding);
    job.steps[0] = {
      name: job.steps[0].name,
      status: "done",
      detail: `confidence ${(job.triage.confidence * 100).toFixed(0)}%`,
    };

    // 2. Patch
    job.status = "patching";
    job.steps[1] = { ...job.steps[1], status: "active" };
    await persist(job);
    await sleep(delay);
    job.patch = await generatePatch(finding);
    job.steps[1] = {
      name: job.steps[1].name,
      status: "done",
      detail: job.patch.llmAssisted ? "LLM-assisted rationale" : "deterministic patch",
    };

    // 3. PoC
    job.status = "proving";
    job.steps[2] = { ...job.steps[2], status: "active" };
    await persist(job);
    await sleep(delay);
    job.poc = runPoc(finding);
    if (!job.poc.beforeVulnerable || !job.poc.afterSecure) {
      job.steps[2] = {
        name: job.steps[2].name,
        status: "failed",
        detail: "PoC gate failed",
      };
      job.status = "failed";
      job.error = "Differential PoC did not prove the vulnerability was closed.";
      await persist(job);
      return job;
    }
    job.steps[2] = {
      name: job.steps[2].name,
      status: "done",
      detail: `${job.poc.durationMs}ms · before vulnerable · after secure`,
    };

    // 4. Regressions
    job.steps[3] = { ...job.steps[3], status: "active" };
    await persist(job);
    await sleep(delay);
    job.regressions = runRegressions(finding);
    const regsOk = job.regressions.every((r) => r.passed);
    if (!regsOk) {
      job.steps[3] = {
        name: job.steps[3].name,
        status: "failed",
        detail: "Regression failure",
      };
      job.status = "failed";
      job.error = "Patch closed the vuln but broke legitimate behavior.";
      await persist(job);
      return job;
    }
    job.steps[3] = {
      name: job.steps[3].name,
      status: "done",
      detail: `${job.regressions.length}/${job.regressions.length} passed`,
    };

    // 5. Deploy package
    job.status = "shipping";
    job.steps[4] = { ...job.steps[4], status: "active" };
    await persist(job);
    await sleep(delay);
    job.deploy = buildDeployPackage(finding, job.patch, job.poc);
    job.steps[4] = {
      name: job.steps[4].name,
      status: "done",
      detail: "PR + CI gate + verify script",
    };

    if (!isVerified(job.poc, job.regressions)) {
      job.status = "failed";
      job.error = "Verification invariant failed.";
      await persist(job);
      return job;
    }

    job.status = "verified";
    await persist(job);
    return job;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    await persist(job);
    return job;
  }
}

export function findingSummary(finding: Finding) {
  return {
    id: finding.id,
    title: finding.title,
    severity: finding.severity,
    cwe: finding.cwe,
    file: finding.file,
    fixtureId: finding.fixtureId,
  };
}
