// Independent review of a proposed policy change by the Guild-hosted "closeloop-reviewer"
// agent, before anything is applied. The Guild session link is the audit trail.
// Never throws: any failure is a verdict of "unavailable" and the deterministic gate decides.
import { z } from "zod";
import type { ExploitHandoffV1 } from "@/contracts/handoff";
import type { PatchProposal, ReviewProposal, ReviewVerdict } from "@/contracts/internal";
import { createGuildClient, guildConfigFromEnv, type GuildClient, type GuildConfig } from "@/lib/guild";

export interface ReviewerDeps {
  env?: Record<string, string | undefined>;
  makeClient?: (config: GuildConfig) => GuildClient;
  /** Overall budget for one review (start + wait + read reply). */
  timeoutMs?: number;
  pollMs?: number;
}

/** The JSON object the reviewer agent receives (see guild/README.md). */
export function buildReviewInput(h: ExploitHandoffV1, p: PatchProposal) {
  return {
    finding: {
      id: h.finding_id,
      title: h.title,
      severity: h.severity,
      description: h.vulnerability.description,
      root_cause: h.vulnerability.root_cause_hypothesis,
      desired_security_property: h.remediation.desired_security_property,
      offending_statement_sid: h.target.offending_policy.statement_sid,
      protected_resource: h.target.protected_resource_arn,
      exploit: { action: h.exploit.replay.action, resource: h.exploit.replay.resource },
    },
    constraints: h.remediation.constraints,
    checks: h.verification.checks.map((c) => ({
      id: c.id,
      kind: c.kind,
      action: c.action,
      resource: c.resource,
      expect: c.expect,
    })),
    policy_before: p.policyBefore,
    policy_after: p.policyAfter,
    summary: p.summary,
    rationale: p.rationale,
  };
}

const Verdict = z.object({
  decision: z.string().transform((s) => s.trim().toLowerCase()).pipe(z.enum(["approve", "reject"])),
  reasons: z
    .union([z.array(z.unknown()), z.string()])
    .optional()
    .transform((r) => (r === undefined ? [] : Array.isArray(r) ? r : [r]).map(String).filter((s) => s.trim())),
});

/** Candidate JSON objects in a reply: the whole text, fenced blocks, then every balanced {...}. */
function jsonCandidates(text: string): string[] {
  const out = [text.trim()];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) out.push(m[1].trim());
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inStr = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        out.push(text.slice(start, i + 1));
        break;
      }
    }
  }
  return out;
}

/** Parses the agent's reply, tolerating code fences and surrounding prose. */
export function parseVerdict(text: string): { decision: "approve" | "reject"; reasons: string[] } | null {
  for (const c of jsonCandidates(text)) {
    let value: unknown;
    try {
      value = JSON.parse(c);
    } catch {
      continue;
    }
    // A reply that is a JSON string holding the object.
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
    }
    const r = Verdict.safeParse(value);
    if (r.success) return r.data;
  }
  return null;
}

class ReviewTimeout extends Error {}

export function createReviewer(deps: ReviewerDeps = {}): ReviewProposal {
  return async (handoff, proposal, jobId): Promise<ReviewVerdict> => {
    const env = deps.env ?? process.env;
    const timeoutMs = deps.timeoutMs ?? (Number(env.CLOSELOOP_REVIEW_TIMEOUT_MS) || 90_000);
    const pollMs = deps.pollMs ?? 2_000;
    let sessionUrl: string | null = null;
    const unavailable = (why: string): ReviewVerdict => ({ decision: "unavailable", reasons: [why], sessionUrl });

    const { config, missing } = guildConfigFromEnv(env);
    if (!config) return unavailable(`Guild reviewer not configured: missing ${missing.join(", ")}`);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ReviewTimeout()), timeoutMs);
    });

    const run = async (): Promise<ReviewVerdict> => {
      const deadline = Date.now() + timeoutMs;
      const client = (deps.makeClient ?? createGuildClient)(config);
      const session = await client.startSession(buildReviewInput(handoff, proposal));
      sessionUrl = session.sessionUrl;
      await client.waitForSession(session.id, { timeoutMs: Math.max(1, deadline - Date.now()), pollMs });
      let text = await client.getFinalOutput(session.id);
      if (!text) {
        // The final runtime_done event can land just after root_task flips to DONE.
        await new Promise((r) => setTimeout(r, Math.min(1_500, pollMs)));
        text = await client.getFinalOutput(session.id);
      }
      if (!text) return unavailable(`reviewer session ${session.id} produced no reply`);
      const verdict = parseVerdict(text);
      if (!verdict) return unavailable(`reviewer reply was not a valid verdict: ${text.slice(0, 200)}`);
      return { decision: verdict.decision, reasons: verdict.reasons, sessionUrl };
    };

    try {
      return await Promise.race([run(), timeout]);
    } catch (err) {
      if (err instanceof ReviewTimeout) return unavailable(`reviewer timed out after ${timeoutMs}ms (job ${jobId})`);
      return unavailable(`reviewer error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  };
}

export const reviewProposal: ReviewProposal = createReviewer();
