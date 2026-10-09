import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { ExploitHandoffV1 } from "@/contracts/handoff";
import type { ExecutionReport, PatchProposal, ReviewVerdict } from "@/contracts/internal";
import { createMemoryStore } from "./memory-store";
import { createPipeline } from "./wiring";

const h = ExploitHandoffV1.parse(
  JSON.parse(readFileSync(path.join(__dirname, "../../../contracts/examples/FIND-002.akash.handoff.json"), "utf8")),
);
const policy = { Version: "2012-10-17" as const, Statement: [] };
const proposal: PatchProposal = { attempt: 1, policyBefore: policy, policyAfter: policy, summary: [], rationale: "", simulated: [] };
const verified: ExecutionReport = { status: "verified", checks: [], exploitBefore: "success", exploitAfter: "blocked", error: null };

function setup(review: ReviewVerdict, report: ExecutionReport = verified) {
  const store = createMemoryStore();
  const execute = vi.fn(async () => ({ ...report }));
  const ship = vi.fn(async () => ({ prUrl: "https://github.com/o/r/pull/1", error: null }));
  const run = createPipeline({ store, review: async () => review, execute, ship });
  return { store, execute, ship, run };
}

describe("A2 pipeline", () => {
  it("approve → apply → ship, PR and review links kept", async () => {
    const { execute, ship, run } = setup({ decision: "approve", reasons: [], sessionUrl: "https://app.guild.ai/s/1" });
    const r = await run(h, proposal, "j1");
    expect(execute).toHaveBeenCalledOnce();
    expect(ship).toHaveBeenCalledOnce();
    expect(r.prUrl).toBe("https://github.com/o/r/pull/1");
    expect(r.reviewSessionUrl).toBe("https://app.guild.ai/s/1");
  });

  it("reject → nothing applied, nothing shipped", async () => {
    const { execute, ship, run, store } = setup({ decision: "reject", reasons: ["widens access"], sessionUrl: null });
    const r = await run(h, proposal, "j2");
    expect(execute).not.toHaveBeenCalled();
    expect(ship).not.toHaveBeenCalled();
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/widens access/);
    expect((await store.getEvents("j2")).some((e) => e.stage === "reviewing")).toBe(true);
  });

  it("reviewer unavailable → still proves live before shipping", async () => {
    const { execute, ship, run } = setup({ decision: "unavailable", reasons: ["timeout"], sessionUrl: null });
    await run(h, proposal, "j3");
    expect(execute).toHaveBeenCalledOnce();
    expect(ship).toHaveBeenCalledOnce();
  });

  it("does not ship a rolled-back fix", async () => {
    const { ship, run } = setup(
      { decision: "approve", reasons: [], sessionUrl: null },
      { ...verified, status: "rolled_back", error: "pos-orders-write failed" },
    );
    const r = await run(h, proposal, "j4");
    expect(ship).not.toHaveBeenCalled();
    expect(r.status).toBe("rolled_back");
  });
});
