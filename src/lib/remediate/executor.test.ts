import type { AddressInfo } from "net";
import type { Server } from "http";
import { readFileSync } from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExploitHandoffV1 } from "@/contracts/handoff";
import type { PatchProposal, PolicyDocument } from "@/contracts/internal";
import type { AkashClient } from "@/lib/akash";
import { createApp } from "../../../lab/api/server.mjs";
import { createExecutor } from "./executor";
import { createMemoryStore } from "./memory-store";

// lab-api reads WORKLOAD_TOKEN at import time, so set it before imports run.
const TOKEN = vi.hoisted(() => (process.env.WORKLOAD_TOKEN = "test-token"));

const BEFORE: PolicyDocument = {
  Version: "2012-10-17",
  Statement: [
    { Sid: "BroadRead", Effect: "Allow", Action: ["data:read"], Resource: ["*"] },
    { Sid: "OrdersWrite", Effect: "Allow", Action: ["orders:write"], Resource: ["orders"] },
  ],
};
const GOOD: PolicyDocument = {
  Version: "2012-10-17",
  Statement: [
    { Sid: "AppRead", Effect: "Allow", Action: ["data:read"], Resource: ["app/*"] },
    { Sid: "OrdersWrite", Effect: "Allow", Action: ["orders:write"], Resource: ["orders"] },
  ],
};
const BREAKS_ORDERS: PolicyDocument = {
  Version: "2012-10-17",
  Statement: [{ Sid: "AppRead", Effect: "Allow", Action: ["data:read"], Resource: ["app/*"] }],
};

const handoff = ExploitHandoffV1.parse(
  JSON.parse(readFileSync(path.join(__dirname, "../../../contracts/examples/FIND-002.akash.handoff.json"), "utf8")),
);

/** Fake Akash: a patch restarts a real local lab-api with the new POLICY_JSON on the same port. */
async function fakeAkash(initial: string, opts: { ignorePatches?: number } = {}) {
  let server: Server = createApp(initial);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const patches: string[] = [];
  let ignore = opts.ignorePatches ?? 0;

  const akash: AkashClient = {
    async getDeployment() {
      return { state: "active", leases: [] };
    },
    async patchServiceEnv(_dseq, _service, env) {
      patches.push(env.POLICY_JSON);
      if (ignore-- > 0) return; // simulate an update that never rolls out
      await new Promise<void>((r) => server.close(() => r()));
      server = createApp(env.POLICY_JSON);
      await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    },
  };
  return {
    akash,
    patches,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const proposal = (after: PolicyDocument): PatchProposal => ({
  attempt: 1,
  policyBefore: BEFORE,
  policyAfter: after,
  summary: [],
  rationale: "",
  simulated: [],
});

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => cleanup?.());

async function setup(initial: PolicyDocument, opts?: { ignorePatches?: number }) {
  const { toLabPolicy } = await import("@/lib/lab");
  const lab = await fakeAkash(JSON.stringify(toLabPolicy(initial)), opts);
  cleanup = lab.close;
  const store = createMemoryStore();
  const execute = createExecutor({
    akash: lab.akash,
    store,
    resolveTarget: () => ({ dseq: "1", service: "lab-api", policyEnvVar: "POLICY_JSON", baseUrl: lab.baseUrl, token: TOKEN }),
    repeats: 3,
    rolloutTimeoutMs: 1_000,
    pollIntervalMs: 50,
  });
  return { lab, store, execute };
}

describe("Akash executor", () => {
  it("verifies a good patch: exploit works before, blocked after, app still works", async () => {
    const { lab, store, execute } = await setup(BEFORE);
    const r = await execute(handoff, proposal(GOOD), "job-good");

    expect(r.error).toBeNull();
    expect(r.status).toBe("verified");
    expect(r.exploitBefore).toBe("success");
    expect(r.exploitAfter).toBe("blocked");
    expect(lab.patches).toHaveLength(1);
    expect(r.checks.filter((c) => c.phase === "live").every((c) => c.passed)).toBe(true);
    expect((await store.getChecks("job-good")).length).toBe(r.checks.length);
  });

  it("rolls back a patch that breaks a legitimate workflow", async () => {
    const { lab, execute } = await setup(BEFORE);
    const r = await execute(handoff, proposal(BREAKS_ORDERS), "job-break");

    expect(r.status).toBe("rolled_back");
    expect(r.error).toMatch(/pos-orders-write/);
    expect(lab.patches).toHaveLength(2);
    const rollback = r.checks.filter((c) => c.phase === "rollback");
    expect(rollback.length).toBeGreaterThan(0);
    expect(rollback.every((c) => c.passed)).toBe(true);
  });

  it("refuses to change anything when the exploit does not reproduce", async () => {
    const { lab, execute } = await setup(GOOD);
    const r = await execute(handoff, proposal(GOOD), "job-noexploit");

    expect(r.status).toBe("failed");
    expect(r.exploitBefore).toBe("blocked");
    expect(lab.patches).toHaveLength(0);
  });

  it("restores the original policy when the rollout never lands", async () => {
    const { lab, execute } = await setup(BEFORE, { ignorePatches: 1 });
    const r = await execute(handoff, proposal(GOOD), "job-timeout");

    expect(r.status).toBe("rolled_back");
    expect(r.error).toMatch(/did not roll out/);
    expect(lab.patches).toHaveLength(2);
  });
});
