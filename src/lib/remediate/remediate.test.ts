import { readFileSync } from "fs";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { ExploitHandoffV1 } from "@/contracts/handoff";
import type { EvidenceStore, PolicyDocument } from "@/contracts/internal";
import { MOCK_POLICY } from "./config";
import { ingestHandoff } from "./ingest";
import { createMemoryStore } from "./memory-store";
import { newJob, runJob, type OrchestratorDeps } from "./orchestrator";
import { proposePatch, type PatchDraft } from "./patcher";
import { evaluateLocally, patchViolations } from "./policy";
import { stubExecuteAndVerify } from "./wiring";

const example = JSON.parse(
  readFileSync(path.join(__dirname, "../../../contracts/examples/FIND-001.handoff.json"), "utf8"),
);
const h = ExploitHandoffV1.parse(example);
const TOKEN = "test-token";
const AUTH = `Bearer ${TOKEN}`;

let store: EvidenceStore;
beforeEach(() => {
  process.env.CLOSELOOP_MOCK = "1";
  process.env.CLOSELOOP_PATCHER = "mock";
  process.env.CLOSELOOP_INGEST_TOKEN = TOKEN;
  delete process.env.LAB_AWS_ACCOUNT_ID;
  store = createMemoryStore();
});

const deps = (proposePatchFn: OrchestratorDeps["proposePatch"] = proposePatch): OrchestratorDeps => ({
  store,
  executeAndVerify: stubExecuteAndVerify,
  proposePatch: proposePatchFn,
});
const run = (d = deps()) => runJob(newJob(crypto.randomUUID(), h.finding_id), h, d);

const GOOD: PolicyDocument = {
  Version: "2012-10-17",
  Statement: [
    { Sid: "BroadS3Read", Effect: "Allow", Action: ["s3:GetObject", "s3:PutObject"], Resource: "arn:aws:s3:::closeloop-lab-app/*" },
    (MOCK_POLICY.Statement[1]),
  ],
};
const draft = (policyAfter: PolicyDocument): PatchDraft => ({ policyAfter, summary: ["s"], rationale: "r" });

describe("policy safety rules", () => {
  it("mock policy reproduces the exploit", () => {
    expect(evaluateLocally(MOCK_POLICY, "s3:GetObject", h.target.protected_resource_arn)).toBe("allow");
  });
  it("accepts narrowing the offending statement", () => {
    expect(patchViolations(MOCK_POLICY, GOOD, "BroadS3Read")).toEqual([]);
  });
  it("rejects touching an unrelated statement", () => {
    const after: PolicyDocument = { ...GOOD, Statement: [GOOD.Statement[0]] };
    expect(patchViolations(MOCK_POLICY, after, "BroadS3Read")[0]).toMatch(/OrdersTable/);
  });
  it("rejects widening", () => {
    const after: PolicyDocument = { ...GOOD, Statement: [{ Effect: "Allow", Action: "s3:*", Resource: "*" }, GOOD.Statement[1]] };
    expect(patchViolations(MOCK_POLICY, after, "BroadS3Read").length).toBeGreaterThan(0);
  });
});

describe("ingest (CONTRACT.md §2.1)", () => {
  const post = (body: unknown, auth: string | null = AUTH) => ingestHandoff(auth, JSON.stringify(body), store);

  it("401 without token", async () => {
    expect((await post(example, null)).status).toBe(401);
  });
  it("400 with zod issues", async () => {
    const r = await post({ ...example, severity: "spicy" });
    expect(r.status).toBe(400);
    expect(r.body.issues).toEqual([expect.objectContaining({ path: "severity" })]);
  });
  it("400 when environment is not authorized-lab", async () => {
    expect((await post({ ...example, scope: { ...example.scope, environment: "prod" } })).status).toBe(400);
  });
  it("403 for a non-lab account", async () => {
    process.env.LAB_AWS_ACCOUNT_ID = "999999999999";
    expect((await post(example)).status).toBe(403);
  });
  it("403 when the role ARN is in another account", async () => {
    const r = await post({ ...example, target: { ...example.target, principal_arn: "arn:aws:iam::444455556666:role/lab-workload-01-role" } });
    expect(r.status).toBe(403);
  });
  it("202 new, 200 identical, 409 different while running", async () => {
    const first = await post(example);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ finding_id: "FIND-001", result_url: `/api/jobs/${first.body.job_id}/result` });

    const again = await post(example);
    expect(again.status).toBe(200);
    expect(again.body.job_id).toBe(first.body.job_id);

    const changed = await post({ ...example, severity: "low" });
    expect(changed.status).toBe(409);
  });
  it("different payload after the job finished starts a new job", async () => {
    const first = await post(example);
    await first.run!();
    const changed = await post({ ...example, severity: "low" });
    expect(changed.status).toBe(202);
    expect(changed.body.job_id).not.toBe(first.body.job_id);
  });
  it("concurrent duplicates create one job", async () => {
    const rs = await Promise.all([1, 2, 3].map(() => post(example)));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 202]);
  });
});

describe("orchestrator", () => {
  it("deterministic patch passes simulation on attempt 1", async () => {
    const job = await run();
    expect(job).toMatchObject({ status: "verified", stage: "done", attempt: 1 });
    const checks = await store.getChecks(job.job_id);
    expect(checks.filter((c) => c.phase === "baseline")).toEqual([
      expect.objectContaining({ check_id: "neg-canary-read", actual: "allow", passed: false }),
    ]);
    expect(checks.filter((c) => c.phase === "simulate").every((c) => c.passed)).toBe(true);
  });

  it("feeds simulator failures back and retries", async () => {
    const seen: (string[] | undefined)[] = [];
    // Attempt 1 drops s3:PutObject (breaks pos-app-write); attempt 2 is correct.
    const dropsWrite: PolicyDocument = { ...GOOD, Statement: [{ ...GOOD.Statement[0], Action: "s3:GetObject" }, GOOD.Statement[1]] };
    const queue = [draft(dropsWrite), draft(GOOD)];
    const job = await run(deps(async ({ feedback }) => (seen.push(feedback), queue.shift()!)));
    expect(job).toMatchObject({ status: "verified", attempt: 2 });
    expect(seen[1]?.join()).toMatch(/pos-app-write/);
  });

  it("fails after 3 unsafe attempts and clears the draft", async () => {
    const job = await run(deps(async () => draft({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }] })));
    expect(job).toMatchObject({ status: "failed", attempt: 3, policy_after: null });
  });

  it("rejects when the offending statement isn't in the policy", async () => {
    const other = ExploitHandoffV1.parse({
      ...example,
      target: { ...example.target, offending_policy: { ...example.target.offending_policy, statement_sid: "Nope" } },
    });
    const job = await runJob(newJob("j", other.finding_id), other, deps());
    expect(job.status).toBe("rejected");
  });

  it("maps executor rollback onto the job", async () => {
    const job = await run({
      ...deps(),
      executeAndVerify: async () => ({ status: "rolled_back", checks: [], exploitBefore: "success", exploitAfter: "blocked", error: "pos-app-read failed live" }),
    });
    expect(job).toMatchObject({ status: "rolled_back", exploit_before: "success", error: "pos-app-read failed live" });
  });
});
