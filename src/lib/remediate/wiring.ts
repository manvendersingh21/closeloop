// Integration point with A2. A1 code takes `store` / `executeAndVerify` from here.
// A2: the Akash executor lives in ./executor.ts.
import type { ExecuteAndVerify, EvidenceStore } from "@/contracts/internal";
import { evidenceStore } from "@/lib/evidence-store";
import { executeAndVerify as akashExecute } from "./executor";

/** Stand-in until A2's executor exists: applies nothing, replays nothing. */
export const stubExecuteAndVerify: ExecuteAndVerify = async () => ({
  status: "verified",
  checks: [],
  exploitBefore: "not_run",
  exploitAfter: "not_run",
  error: null,
});

export const store: EvidenceStore = evidenceStore;
/** Akash lab hand-offs (an `akash` block, or AKASH_LAB_DSEQ set) run the real executor; anything else keeps the stub. */
export const executeAndVerify: ExecuteAndVerify = (h, proposal, jobId) =>
  process.env.CLOSELOOP_EXECUTOR !== "stub" && (h.akash || process.env.AKASH_LAB_DSEQ)
    ? akashExecute(h, proposal, jobId)
    : stubExecuteAndVerify(h, proposal, jobId);
