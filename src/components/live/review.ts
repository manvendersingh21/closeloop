import type { JobEvent } from "@/contracts/internal";
import { guildUrls } from "./links";

export type ReviewDecision = "approved" | "rejected" | "unavailable";

export type ReviewInfo = {
  decision: ReviewDecision;
  /** Reviewer reasons (rejected) or why no verdict was reached (unavailable). */
  reasons: string | null;
  sessionUrl: string | null;
  ts: string;
};

export type ShipInfo = { prUrl: string; reason?: undefined } | { prUrl?: undefined; reason: string };

function latest(events: JobEvent[], stage: string): JobEvent | null {
  let hit: JobEvent | null = null;
  for (const e of events) if (e.stage === stage && (!hit || e.ts >= hit.ts)) hit = e;
  return hit;
}

function decisionOf(message: string): ReviewDecision | null {
  const lead = /\breviewer\s+(approved|rejected|unavailable)\b/i.exec(message);
  if (lead) return lead[1].toLowerCase() as ReviewDecision;
  const m = message.toLowerCase();
  if (m.includes("rejected")) return "rejected";
  if (m.includes("unavailable")) return "unavailable";
  if (m.includes("approved")) return "approved";
  return null;
}

function reasonsOf(decision: ReviewDecision, message: string, sessionUrl: string | null): string | null {
  const text = (sessionUrl ? message.split(sessionUrl).join("") : message).replace(/[\s—–-]+$/, "").trim();
  if (decision === "rejected") {
    const after = /\brejected[^:]*:\s*([\s\S]+)$/i.exec(text);
    return after?.[1].trim() || null;
  }
  if (decision === "unavailable") {
    const inner = /\bunavailable\s*\(([\s\S]+)\)\s*;?[^()]*$/i.exec(text);
    return inner?.[1].trim() || null;
  }
  return null;
}

/** Verdict from the most recent "reviewing" event, or null when the reviewer never ran. */
export function reviewFromEvents(events: JobEvent[]): ReviewInfo | null {
  const e = latest(events, "reviewing");
  if (!e) return null;
  const decision = decisionOf(e.message);
  if (!decision) return null;
  const sessionUrl = guildUrls([e.message])[0] ?? null;
  return { decision, reasons: reasonsOf(decision, e.message, sessionUrl), sessionUrl, ts: e.ts };
}

/** Outcome of the most recent "shipping" event, or null when nothing was shipped yet. */
export function shipFromEvents(events: JobEvent[]): ShipInfo | null {
  const e = latest(events, "shipping");
  if (!e) return null;
  const opened = /opened pull request\s+(https?:\/\/\S+)/i.exec(e.message);
  if (opened) return { prUrl: opened[1].replace(/[.,;:!?)]+$/, "") };
  const notOpened = /not opened:\s*([\s\S]+)$/i.exec(e.message);
  return { reason: (notOpened?.[1] ?? e.message).trim() || "no reason given" };
}
