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
Return policy_json as a JSON string of the full policy document, summary as short bullet strings, rationale as 2-3 sentences for a PR description.`;

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

async function openaiPatch({ handoff: h, policyBefore, feedback }: PatchInput, key: string): Promise<PatchDraft> {
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

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1",
      temperature: 0,
      response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(user, null, 2) },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = (await res.json()) as { choices?: { message?: { content?: string; refusal?: string } }[] };
  const msg = data.choices?.[0]?.message;
  if (!msg?.content) throw new Error(`OpenAI returned no content${msg?.refusal ? `: ${msg.refusal}` : ""}`);

  const out = JSON.parse(msg.content) as { policy_json: string; summary: string[]; rationale: string };
  return { policyAfter: normalizePolicy(JSON.parse(out.policy_json)), summary: out.summary, rationale: out.rationale };
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
  const key = process.env.OPENAI_API_KEY;
  if (key && process.env.CLOSELOOP_PATCHER !== "mock") return openaiPatch(input, key);
  if (isMock() || process.env.CLOSELOOP_PATCHER === "mock") return deterministicPatch(input);
  throw new Error("OPENAI_API_KEY is not set");
}
