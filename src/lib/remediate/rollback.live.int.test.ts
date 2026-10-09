// Live rollback proof: apply a patch that breaks orders:write, expect rolled_back + lab restored.
// Opt-in: CLOSELOOP_LIVE_ROLLBACK=1 pnpm exec vitest run -c vitest.int.config.ts src/lib/remediate/rollback.live.int.test.ts
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

const live = process.env.CLOSELOOP_LIVE_ROLLBACK === "1";

const raw = JSON.parse(
  readFileSync(path.join(__dirname, "../../../contracts/examples/FIND-002.akash.handoff.json"), "utf8"),
);
raw.akash = { ...raw.akash, dseq: process.env.AKASH_LAB_DSEQ, base_url: process.env.LAB_BASE_URL };

describe.skipIf(!live)("Akash executor rollback (live)", () => {
  const h = ExploitHandoffV1.parse(raw);
  const target = resolveLabTarget(h);
  let baseline: PolicyDocument;

  afterAll(async () => {
    if (!baseline) return;
    await akashClient.patchServiceEnv(target.dseq, target.service, {
      POLICY_JSON: JSON.stringify(toLabPolicy(baseline)),
    });
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${target.baseUrl}/data/canary/secret.txt`, {
          headers: { authorization: `Bearer ${target.token}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 200) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error("lab did not return to vulnerable baseline after rollback test");
  }, 300_000);

  it("rolls back when a patch breaks orders:write", async () => {
    baseline = fromLabPolicy(await fetchLivePolicy(target));
    // Bad patch: narrow BroadRead but drop OrdersWrite — passes canary intent, breaks legitimate write.
    const after: PolicyDocument = {
      Version: "2012-10-17",
      Statement: baseline.Statement.filter((s) => s.Sid !== "OrdersWrite").map((s) =>
        s.Sid === "BroadRead" ? { ...s, Sid: "AppRead", Resource: ["app/*"] } : s,
      ),
    };
    const store = createMemoryStore();
    const execute = createExecutor({ ...defaultExecutorDeps, store });
    const r = await execute(
      h,
      {
        attempt: 1,
        policyBefore: baseline,
        policyAfter: after,
        summary: ["deliberately break orders for rollback demo"],
        rationale: "Prove live rollback restores the original policy.",
        simulated: [],
      },
      "live-rollback",
    );

    console.log(`status=${r.status} exploit ${r.exploitBefore}→${r.exploitAfter}`);
    for (const e of await store.getEvents("live-rollback")) console.log(`  [${e.stage}] ${e.message}`);
    expect(r.status).toBe("rolled_back");
    expect(r.error).toMatch(/pos-orders-write/);
    expect(r.checks.some((c) => c.phase === "rollback" && c.passed)).toBe(true);

    // Lab should be back on the original policy.
    const livePolicy = await fetchLivePolicy(target);
    expect(JSON.stringify(livePolicy)).toBe(JSON.stringify(toLabPolicy(baseline)));
  }, 300_000);
});
