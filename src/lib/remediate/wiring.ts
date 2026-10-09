// Integration point with A2. A1 code takes `store` / `executeAndVerify` from here.
// A2: review (Guild) → apply + prove live (Akash executor) → ship (GitHub PR).
import type { ExecuteAndVerify, EvidenceStore, ReviewProposal, ShipFix } from "@/contracts/internal";
import { evidenceStore } from "@/lib/evidence-store";
import { executeAndVerify as akashExecute } from "./executor";
import { reviewProposal } from "./reviewer";
import { shipFix } from "./ship";

/** Stand-in for non-Akash hand-offs: applies nothing, replays nothing. */
export const stubExecuteAndVerify: ExecuteAndVerify = async () => ({
  status: "verified",
  checks: [],
  exploitBefore: "not_run",
  exploitAfter: "not_run",
  error: null,
});

export const store: EvidenceStore = evidenceStore;

export interface PipelineDeps {
  store: EvidenceStore;
  review: ReviewProposal;
  execute: ExecuteAndVerify;
  ship: ShipFix;
}

/**
 * The independent reviewer can veto a proposal before anything touches the lab;
 * if the reviewer is unavailable, the deterministic live proof still decides.
 */
export function createPipeline(deps: PipelineDeps): ExecuteAndVerify {
  return async (h, proposal, jobId) => {
    const event = (stage: string, msg: string, level?: "info" | "warn" | "error") =>
      deps.store.recordEvent(jobId, stage, msg, level);

    const review = await deps.review(h, proposal, jobId);
    const link = review.sessionUrl ? ` — ${review.sessionUrl}` : "";
    if (review.decision === "reject") {
      const why = review.reasons.join("; ") || "no reason given";
      await event("reviewing", `Guild reviewer rejected the patch: ${why}${link}`, "warn");
      return {
        status: "failed",
        checks: [],
        exploitBefore: "not_run",
        exploitAfter: "not_run",
        error: `rejected by reviewer: ${why}`,
        reviewSessionUrl: review.sessionUrl,
      };
    }
    await event(
      "reviewing",
      review.decision === "approve"
        ? `Guild reviewer approved the patch${link}`
        : `Guild reviewer unavailable (${review.reasons.join("; ")}); continuing on live proof${link}`,
      review.decision === "approve" ? "info" : "warn",
    );

    const report = await deps.execute(h, proposal, jobId);
    report.reviewSessionUrl = review.sessionUrl;
    if (report.status !== "verified") return report;

    const shipped = await deps.ship({ handoff: h, proposal, report, jobId, review });
    report.prUrl = shipped.prUrl;
    await event(
      "shipping",
      shipped.prUrl ? `Opened pull request ${shipped.prUrl}` : `Pull request not opened: ${shipped.error}`,
      shipped.prUrl ? "info" : "warn",
    );
    return report;
  };
}

const akashPipeline = createPipeline({ store, review: reviewProposal, execute: akashExecute, ship: shipFix });

/** Akash lab hand-offs (an `akash` block, or AKASH_LAB_DSEQ set) run the real pipeline; anything else keeps the stub. */
export const executeAndVerify: ExecuteAndVerify = (h, proposal, jobId) =>
  process.env.CLOSELOOP_EXECUTOR !== "stub" && (h.akash || process.env.AKASH_LAB_DSEQ)
    ? akashPipeline(h, proposal, jobId)
    : stubExecuteAndVerify(h, proposal, jobId);
