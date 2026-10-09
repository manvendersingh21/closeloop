// Integration point with A2. A1 code takes `store` / `executeAndVerify` from here.
// A2: when src/lib/remediate/executor.ts lands, import it below instead of the stub.
import type { ExecuteAndVerify, EvidenceStore } from "@/contracts/internal";
import { evidenceStore } from "@/lib/evidence-store";

/** Stand-in until A2's executor exists: applies nothing, replays nothing. */
export const stubExecuteAndVerify: ExecuteAndVerify = async () => ({
  status: "verified",
  checks: [],
  exploitBefore: "not_run",
  exploitAfter: "not_run",
  error: null,
});

export const store: EvidenceStore = evidenceStore;
export const executeAndVerify: ExecuteAndVerify = stubExecuteAndVerify;
