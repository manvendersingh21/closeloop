// Integration test for the ClickHouse-backed EvidenceStore. Runs against the
// real server configured via CLICKHOUSE_* env vars (loaded from .env if
// present); skipped entirely when CLICKHOUSE_URL is not set.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  ExploitHandoffV1,
  RemediationResultV1,
  type RemediationResultV1 as RemediationResult,
} from "@/contracts/handoff";
import type { JobRecord, PolicyDocument } from "@/contracts/internal";
import { evidenceStore } from "@/lib/evidence-store";
import { buildResult } from "@/lib/result";

try {
  process.loadEnvFile(".env");
} catch {
  // env may come from the shell
}

const exampleHandoff = ExploitHandoffV1.parse(
  JSON.parse(readFileSync(path.resolve("contracts/examples/FIND-001.handoff.json"), "utf8")),
);
const exampleResult: RemediationResult = RemediationResultV1.parse(
  JSON.parse(readFileSync(path.resolve("contracts/examples/FIND-001.result.json"), "utf8")),
);
if (!exampleResult.change) throw new Error("example result must contain a change");

const rand = Math.random().toString(36).slice(2, 10);
const jobId = `itest-${rand}`;
const jobIdNoChange = `itest-nochange-${rand}`;
const findingId = `FIND-ITEST-${rand.toUpperCase()}`;

const handoff = ExploitHandoffV1.parse({ ...exampleHandoff, finding_id: findingId });
const policyBefore = exampleResult.change.before as PolicyDocument;
const policyAfter = exampleResult.change.after as PolicyDocument;

const jobQueued: JobRecord = {
  job_id: jobId,
  finding_id: findingId,
  status: "in_progress",
  stage: "queued",
  attempt: 1,
  policy_before: policyBefore,
  policy_after: null,
  summary: [],
  rationale: "",
  exploit_before: "success",
  exploit_after: "not_run",
  pr_url: null,
  error: null,
  started_at: new Date().toISOString(),
  finished_at: null,
};

const jobVerified: JobRecord = {
  ...jobQueued,
  status: "verified",
  stage: "done",
  attempt: 2,
  policy_after: policyAfter,
  summary: exampleResult.change.summary,
  rationale: exampleResult.rationale,
  exploit_after: "blocked",
  finished_at: new Date().toISOString(),
};

const jobNoChange: JobRecord = {
  ...jobQueued,
  job_id: jobIdNoChange,
  status: "in_progress",
  stage: "patching",
  started_at: new Date(Date.now() + 60_000).toISOString(),
};

async function rawClickHouse(statement: string): Promise<void> {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) throw new Error("CLICKHOUSE_URL is not set");
  const user = process.env.CLICKHOUSE_USER ?? "default";
  const password = process.env.CLICKHOUSE_PASSWORD ?? "";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
    },
    body: statement,
  });
  if (!res.ok) throw new Error(await res.text());
}

describe.skipIf(!process.env.CLICKHOUSE_URL)("evidenceStore (integration)", () => {
  it(
    "saveHandoff / getHandoff round-trips the full handoff",
    { timeout: 30_000 },
    async () => {
      await evidenceStore.saveHandoff(handoff);
      expect(await evidenceStore.getHandoff(findingId)).toEqual(handoff);
      expect(await evidenceStore.getHandoff("FIND-ITEST-does-not-exist")).toBeNull();
    },
  );

  it(
    "upsertJob twice then getJob returns the latest row (FINAL wins)",
    { timeout: 30_000 },
    async () => {
      await evidenceStore.upsertJob(jobQueued);
      // no sleep: ms-precision updated_at must order these two upserts
      await evidenceStore.upsertJob(jobVerified);
      expect(await evidenceStore.getJob(jobId)).toEqual(jobVerified);
      expect(await evidenceStore.getJob("itest-does-not-exist")).toBeNull();
    },
  );

  it(
    "findLatestJobForFinding and listJobs",
    { timeout: 30_000 },
    async () => {
      let latest = await evidenceStore.findLatestJobForFinding(findingId);
      expect(latest?.job_id).toBe(jobId);

      await evidenceStore.upsertJob(jobNoChange);
      latest = await evidenceStore.findLatestJobForFinding(findingId);
      expect(latest?.job_id).toBe(jobIdNoChange);

      const jobs = await evidenceStore.listJobs(50);
      expect(jobs.some((j) => j.job_id === jobId)).toBe(true);
      const startedAt = jobs.map((j) => j.started_at);
      for (let i = 1; i < startedAt.length; i++) {
        expect(startedAt[i - 1] >= startedAt[i]).toBe(true);
      }
    },
  );

  it(
    "recordCheck / getChecks round-trip every CheckResult field",
    { timeout: 30_000 },
    async () => {
      for (const check of exampleResult.checks) {
        await evidenceStore.recordCheck(jobId, findingId, check);
      }
      const sortKey = (c: { phase: string; check_id: string; attempt: number }) =>
        `${c.phase}|${c.check_id}|${c.attempt}`;
      const got = await evidenceStore.getChecks(jobId);
      expect([...got].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))).toEqual(
        [...exampleResult.checks].sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
      );
      expect(await evidenceStore.getChecks(jobIdNoChange)).toEqual([]);
    },
  );

  it(
    "recordEvent / getEvents returns timeline ordered by ts",
    { timeout: 30_000 },
    async () => {
      await evidenceStore.recordEvent(jobId, "queued", `Job accepted for ${findingId}`);
      await evidenceStore.recordEvent(jobId, "verifying", "Live exploit replay blocked", "warn");
      const events = await evidenceStore.getEvents(jobId);
      expect(events).toHaveLength(2);
      expect(events[0].stage).toBe("queued");
      expect(events[0].level).toBe("info");
      expect(events[0].message).toBe(`Job accepted for ${findingId}`);
      expect(events[1].stage).toBe("verifying");
      expect(events[1].level).toBe("warn");
      for (const e of events) {
        expect(e.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
      }
      expect(events[0].ts <= events[1].ts).toBe(true);
    },
  );

  it(
    "buildResult assembles a valid remediation-result/v1",
    { timeout: 30_000 },
    async () => {
      const result = await buildResult(jobId);
      expect(result).not.toBeNull();
      expect(result?.schema_version).toBe("remediation-result/v1");
      expect(result?.job_id).toBe(jobId);
      expect(result?.finding_id).toBe(findingId);
      expect(result?.status).toBe("verified");
      expect(result?.stage).toBe("done");
      expect(result?.attempts).toBe(2);
      expect(result?.change?.type).toBe("iam_inline_policy");
      expect(result?.change?.role_name).toBe(handoff.target.role_name);
      expect(result?.change?.policy_name).toBe(handoff.target.offending_policy.policy_name);
      expect(result?.change?.before).toEqual(policyBefore);
      expect(result?.change?.after).toEqual(policyAfter);
      expect(result?.checks).toHaveLength(exampleResult.checks.length);
      expect(result?.exploit_replay).toEqual({ before: "success", after: "blocked" });
      expect(result?.started_at).toBe(jobVerified.started_at);
      expect(result?.finished_at).toBe(jobVerified.finished_at);

      const noChange = await buildResult(jobIdNoChange);
      expect(noChange?.change).toBeNull();
      expect(noChange?.status).toBe("in_progress");

      expect(await buildResult("itest-does-not-exist")).toBeNull();
    },
  );

  afterAll(async () => {
    await rawClickHouse("ALTER TABLE closeloop.jobs DELETE WHERE job_id LIKE 'itest-%'");
    await rawClickHouse(
      "ALTER TABLE closeloop.verification_checks DELETE WHERE job_id LIKE 'itest-%'",
    );
    await rawClickHouse("ALTER TABLE closeloop.events DELETE WHERE job_id LIKE 'itest-%'");
    await rawClickHouse(
      "ALTER TABLE closeloop.handoffs DELETE WHERE finding_id LIKE 'FIND-ITEST-%'",
    );
  }, 60_000);
});
