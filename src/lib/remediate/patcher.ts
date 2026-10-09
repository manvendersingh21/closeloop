import type { ExploitHandoffV1 } from "@/contracts/handoff";
import type { PolicyDocument, PolicyStatement } from "@/contracts/internal";
import { isMock } from "./config";
import { evaluateLocally, normalizePolicy } from "./policy";

export interface PatchDraft {
  policyAfter: PolicyDocument;
  summary: string[];
  rationale: string;
}

export interface PatchInput {
  handoff: ExploitHandoffV1;
  policyBefore: PolicyDocument;
  /** Why the previous attempt was rejected (simulator failures / safety violations). */
  feedback?: string[];
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const SYSTEM = `You are a staff AWS IAM engineer doing least-privilege remediation.
You get an inline IAM policy, a validated exploit hand-off naming the offending statement Sid, and machine checks.
Return the full corrected policy. Rules:
- Every check with expect "deny" must be denied; every check with expect "allow" must stay allowed.
- Change ONLY the offending statement. Copy every other statement exactly.
- Only narrow: split the offending statement, narrow its Resource ARNs, or drop actions. Never add actions, resources or wildcards the original did not grant. No NotAction, NotResource or Principal.
- Version must be "2012-10-17".
Return ONLY a JSON object with keys policy_json (stringified full policy document), summary (string array), rationale (string). No markdown fences.`;

const RESPONSE_SCHEMA = {
  name: "policy_patch",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["policy_json", "summary", "rationale"],
    properties: {
      policy_json: { type: "string" },
      summary: { type: "array", items: { type: "string" } },
      rationale: { type: "string" },
    },
  },
};

function parsePatchContent(content: string): PatchDraft {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const out = JSON.parse(trimmed) as { policy_json: string | PolicyDocument; summary: string[]; rationale: string };
  const policy =
    typeof out.policy_json === "string" ? normalizePolicy(JSON.parse(out.policy_json)) : normalizePolicy(out.policy_json);
  return { policyAfter: policy, summary: out.summary, rationale: out.rationale };
}

async function chatPatch(
  { handoff: h, policyBefore, feedback }: PatchInput,
  opts: { url: string; key: string; model: string; structured: boolean; label: string },
): Promise<PatchDraft> {
  const user = {
    finding: {
      id: h.finding_id,
      title: h.title,
      vulnerability: h.vulnerability,
      protected_resource_arn: h.target.protected_resource_arn,
      exploit_replay: h.exploit.replay,
      remediation: h.remediation,
    },
    role_name: h.target.role_name,
    offending_statement_sid: h.target.offending_policy.statement_sid,
    current_policy: policyBefore,
    checks: h.verification.checks,
    previous_attempt_rejected_because: feedback ?? [],
  };

  const body: Record<string, unknown> = {
    model: opts.model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify(user, null, 2) },
    ],
  };
  if (opts.structured) {
    body.response_format = { type: "json_schema", json_schema: RESPONSE_SCHEMA };
  }

  const res = await fetch(opts.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`${opts.label} ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = (await res.json()) as { choices?: { message?: { content?: string; refusal?: string } }[] };
  const msg = data.choices?.[0]?.message;
  if (!msg?.content) throw new Error(`${opts.label} returned no content${msg?.refusal ? `: ${msg.refusal}` : ""}`);
  return parsePatchContent(msg.content);
}

/**
 * Offline fallback: rewrite the offending statement to grant exactly the allow-checks
 * it currently satisfies (action on exact resource), and nothing else.
 */
function deterministicPatch({ handoff: h, policyBefore }: PatchInput): PatchDraft {
  const sid = h.target.offending_policy.statement_sid;
  const offending = policyBefore.Statement.find((s) => s.Sid === sid);
  if (!offending) throw new Error(`statement ${sid} not found in policy`);

  const single: PolicyDocument = { Version: "2012-10-17", Statement: [offending] };
  const needed = h.verification.checks.filter(
    (c) => c.expect === "allow" && evaluateLocally(single, c.action, c.resource) === "allow",
  );
  const byAction = new Map<string, string[]>();
  for (const c of needed) byAction.set(c.action, [...(byAction.get(c.action) ?? []), c.resource]);

  const replacement: PolicyStatement[] = [...byAction].map(([action, resources], i) => ({
    Sid: i === 0 ? sid : `${sid}${i + 1}`,
    Effect: "Allow",
    Action: action,
    Resource: resources.length === 1 ? resources[0] : resources,
  }));
  const Statement = policyBefore.Statement.flatMap((s) => (s.Sid === sid ? replacement : [s]));

  return {
    policyAfter: { Version: "2012-10-17", Statement },
    summary: [
      `Narrowed ${sid} to the ${needed.length} resource(s) the workload is verified to need`,
      "Left all other statements unchanged",
    ],
    rationale: `${sid} granted access beyond what the workload uses, including ${h.target.protected_resource_arn}. It now grants only the actions and resources covered by the hand-off's allow checks.`,
  };
}

export async function proposePatch(input: PatchInput): Promise<PatchDraft> {
  if (isMock() || process.env.CLOSELOOP_PATCHER === "mock") return deterministicPatch(input);

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const akashKey = process.env.AKASH_LLM_API_KEY?.trim();
  const akashBase = (process.env.AKASH_LLM_BASE_URL || "").replace(/\/$/, "");
  const akashModel = process.env.AKASH_LLM_MODEL || "qwen-abliterated";

  const errors: string[] = [];

  if (openaiKey && process.env.CLOSELOOP_PATCHER !== "akash") {
    try {
      return await chatPatch(input, {
        url: OPENAI_URL,
        key: openaiKey,
        model: process.env.OPENAI_MODEL || "gpt-4.1",
        structured: true,
        label: "OpenAI",
      });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (akashKey && akashBase) {
    const akashUrl = akashBase.endsWith("/chat/completions")
      ? akashBase
      : akashBase.endsWith("/v1")
        ? `${akashBase}/chat/completions`
        : `${akashBase}/v1/chat/completions`;
    try {
      return await chatPatch(input, {
        url: akashUrl,
        key: akashKey,
        model: akashModel,
        structured: false,
        label: "AkashLLM",
      });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (process.env.CLOSELOOP_PATCHER === "deterministic" || errors.length > 0) {
    // Last resort so a bad cloud key does not block an otherwise live demo.
    try {
      return deterministicPatch(input);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  throw new Error(errors[0] || "no patcher available: set OPENAI_API_KEY or AKASH_LLM_*");
}
