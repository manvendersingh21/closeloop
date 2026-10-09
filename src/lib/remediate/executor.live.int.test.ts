// Live end-to-end check of the Akash executor against the real lab deployment.
// Opt-in: CLOSELOOP_LIVE_E2E=1 pnpm test:live. It changes the live lab, then restores the vulnerable baseline.
import { readFileSync } from "fs";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { ExploitHandoffV1 } from "@/contracts/handoff";
import type { PolicyDocument } from "@/contracts/internal";
import { akashClient } from "@/lib/akash";
import { fetchLivePolicy, fromLabPolicy, resolveLabTarget, toLabPolicy } from "@/lib/lab";
import { createExecutor, defaultExecutorDeps } from "./executor";
import { createMemoryStore } from "./memory-store";

try {
  process.loadEnvFile(".env");
} catch {}

const live = process.env.CLOSELOOP_LIVE_E2E === "1";

const raw = JSON.parse(
  readFileSync(path.join(__dirname, "../../../contracts/examples/FIND-002.akash.handoff.json"), "utf8"),
);
raw.akash = { ...raw.akash, dseq: process.env.AKASH_LAB_DSEQ, base_url: process.env.LAB_BASE_URL };

describe.skipIf(!live)("Akash executor (live)", () => {
  const h = ExploitHandoffV1.parse(raw);
  const target = resolveLabTarget(h);
  let baseline: PolicyDocument;

  afterAll(async () => {
    // Put the vulnerable baseline back so the demo can run again.
    if (!baseline) return;
    await akashClient.patchServiceEnv(target.dseq, target.service, { POLICY_JSON: JSON.stringify(toLabPolicy(baseline)) });
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      try {
        if (JSON.stringify(await fetchLivePolicy(target)) === JSON.stringify(toLabPolicy(baseline))) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error("lab did not return to the vulnerable baseline");
  }, 300_000);

  it("fixes the live lab: exploit success → blocked, app checks pass", async () => {
    baseline = fromLabPolicy(await fetchLivePolicy(target));
    const after: PolicyDocument = {
      Version: "2012-10-17",
      Statement: baseline.Statement.map((s) => (s.Sid === "BroadRead" ? { ...s, Sid: "AppRead", Resource: ["app/*"] } : s)),
    };
    const store = createMemoryStore();
    const execute = createExecutor({ ...defaultExecutorDeps, store });
    const started = Date.now();
    const r = await execute(h, { attempt: 1, policyBefore: baseline, policyAfter: after, summary: [], rationale: "", simulated: [] }, "live-e2e");

    console.log(`status=${r.status} exploit ${r.exploitBefore}→${r.exploitAfter} in ${Math.round((Date.now() - started) / 1000)}s`);
    for (const e of await store.getEvents("live-e2e")) console.log(`  [${e.stage}] ${e.message}`);
    expect(r.error).toBeNull();
    expect(r.status).toBe("verified");
    expect(r.exploitBefore).toBe("success");
    expect(r.exploitAfter).toBe("blocked");
  }, 300_000);
});
