import type { JobEvent, JobStage, JobStatus } from "@/contracts/internal";
import { reviewFromEvents, type ReviewInfo } from "./review";
import { STAGES } from "./types";

type StepState = "done" | "active" | "failed" | "pending" | "skipped" | "bypassed";
type StepId = JobStage | "reviewing";

// result.stage never reports "reviewing"; the step is inferred from "reviewing" events.
const STEPS: { id: StepId; label: string; hint: string }[] = STAGES.flatMap((s) =>
  s.id === "applying"
    ? [
        { id: "reviewing" as const, label: "Reviewing", hint: "Guild reviewer verdict" },
        { ...s, hint: "Deploy to the Akash lab" },
      ]
    : [s],
);
const REVIEW_IDX = STEPS.findIndex((s) => s.id === "reviewing");
const LAST = STEPS.length - 1;

// Event stages that are not pipeline steps, mapped to where they happen.
const EVENT_STAGE: Record<string, StepId> = {
  baseline: "patching",
  review: "reviewing",
  rollback: "verifying",
  shipping: "done",
};

function idxOf(stage: string): number {
  const mapped = EVENT_STAGE[stage] ?? stage;
  return STEPS.findIndex((s) => s.id === mapped);
}

/** Reviewing is only "done" with an actual approval; otherwise the job went on without a verdict. */
function passedReview(review: ReviewInfo | null): StepState {
  if (!review) return "skipped";
  return review.decision === "approved" ? "done" : "bypassed";
}

function stepStates(
  stage: JobStage,
  status: JobStatus,
  events: JobEvent[],
  review: ReviewInfo | null,
): { states: StepState[]; progress: number } {
  if (status === "in_progress") {
    let cur = idxOf(stage);
    if (stage === "applying" && !review) cur = REVIEW_IDX;
    const states = STEPS.map((_, i): StepState => {
      if (i === REVIEW_IDX && i < cur) return passedReview(review);
      return i < cur ? "done" : i === cur ? "active" : "pending";
    });
    return { states, progress: Math.max(0, cur) };
  }
  if (status === "verified") {
    return { states: STEPS.map((_, i) => (i === REVIEW_IDX ? passedReview(review) : "done")), progress: STEPS.length };
  }
  // Terminal failure: the job jumps straight to "done", so find the furthest
  // real step it reached from the event log and mark that one as failed.
  const reached =
    review?.decision === "rejected"
      ? REVIEW_IDX
      : events.reduce((m, e) => {
          const i = idxOf(e.stage);
          return i >= 0 && i < LAST ? Math.max(m, i) : m;
        }, 0);
  const states = STEPS.map((_, i): StepState => {
    if (i === LAST) return "failed";
    if (i === REVIEW_IDX && i < reached) return passedReview(review);
    return i < reached ? "done" : i === reached ? "failed" : "skipped";
  });
  return { states, progress: reached };
}

const STATE_STYLE: Record<StepState, { color: string; bg: string; label: string }> = {
  done: { color: "var(--ok)", bg: "var(--cl-ok-bg)", label: "done" },
  active: { color: "var(--warn)", bg: "var(--cl-warn-bg)", label: "running" },
  failed: { color: "var(--danger)", bg: "var(--cl-bad-bg)", label: "stopped" },
  pending: { color: "var(--muted)", bg: "var(--cl-well)", label: "pending" },
  skipped: { color: "var(--muted)", bg: "var(--cl-well)", label: "skipped" },
  bypassed: { color: "var(--warn)", bg: "var(--cl-warn-bg)", label: "no verdict" },
};

export function StageStepper({
  stage,
  status,
  events,
}: {
  stage: JobStage;
  status: JobStatus;
  events: JobEvent[];
}) {
  const review = reviewFromEvents(events);
  const { states, progress } = stepStates(stage, status, events, review);
  const pct = (progress / STEPS.length) * 100;
  const barColor = status === "verified" ? "var(--ok)" : status === "in_progress" ? "var(--action)" : "var(--danger)";
  const activeIdx = states.indexOf("active");
  const shownStage = activeIdx >= 0 ? STEPS[activeIdx].id : stage;

  return (
    <section className="stage p-5 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="display text-lg md:text-xl">Pipeline</h2>
        <span className="mono text-xs uppercase text-[var(--muted)]">stage: {shownStage}</span>
      </div>
      <div className="mb-5 h-2.5 overflow-hidden rounded-full bg-[var(--cl-well)]">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
      <ol className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
        {STEPS.map((s, i) => {
          const st = STATE_STYLE[states[i]];
          const isCurrent = states[i] === "active" || (states[i] === "failed" && i < LAST);
          return (
            <li
              key={s.id}
              aria-current={isCurrent ? "step" : undefined}
              className="min-w-0 rounded-2xl px-3 py-3 transition-colors duration-300"
              style={{
                background: st.bg,
                boxShadow: isCurrent ? `inset 0 0 0 2px ${st.color}` : undefined,
                opacity: states[i] === "skipped" ? 0.55 : 1,
              }}
            >
              <div
                className="mono flex items-center gap-1.5 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider"
                style={{ color: st.color }}
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${states[i] === "active" ? "cl-pulse" : ""}`}
                  style={{ background: st.color }}
                />
                {i + 1} · {st.label}
              </div>
              <div className="mt-1 text-sm font-extrabold leading-snug">{s.label}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">{s.hint}</div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
