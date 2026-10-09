#!/usr/bin/env node
// Idempotent Guild.ai setup for CloseLoop's independent policy reviewer.
//   1. workspace "closeloop" under the key's own account
//   2. LLM agent "closeloop-reviewer" (system prompt below, no tools)
//   3. a published version whose summary carries the prompt hash (re-run = no-op)
//   4. the agent installed in the workspace
// Prints the NON-secret .env lines at the end. Never prints the API key.
import { createHash } from "node:crypto";

try {
  process.loadEnvFile(".env");
} catch {
  /* no .env: rely on the real environment */
}

const API = (process.env.GUILD_API_URL || "https://api.guild.ai/v1").replace(/\/$/, "");
const WORKSPACE = process.env.GUILD_WORKSPACE_NAME || "closeloop";
const AGENT = "closeloop-reviewer";

export const SYSTEM_PROMPT = `You are closeloop-reviewer, an independent cloud security reviewer. An automated remediation system (CloseLoop) proposes a least-privilege change to an access policy and asks you to review it BEFORE it is applied. You are a second pair of eyes: be strict, concrete and brief.

INPUT: the user message is a single JSON object:
{
  "finding": { "id", "title", "severity", "description", "root_cause", "desired_security_property", "offending_statement_sid", "protected_resource", "exploit": { "action", "resource" } },
  "constraints": [string],          // must all hold after the change
  "checks": [ { "id", "kind": "negative"|"positive"|"regression", "action", "resource", "expect": "allow"|"deny" } ],
  "policy_before": { "Version", "Statement": [ { "Sid", "Effect", "Action", "Resource", "Condition"? } ] },
  "policy_after":  { same shape },
  "summary": [string],              // what the proposer says it changed
  "rationale": string
}
Action and Resource may be a string or a list. "*" and trailing "prefix/*" are wildcards.

APPROVE only if ALL of the following are true:
1. policy_after narrows access so the exploit (finding.exploit action on resource) and every "negative" check is denied.
2. policy_after never widens any permission: no statement gains actions, resources, wildcards or broader patterns, no Allow is added, no Deny or Condition is removed or loosened.
3. Statements unrelated to the finding (other Sids) are byte-for-byte unchanged in Effect, Action, Resource and Condition, and none are removed.
4. Every "positive" and "regression" check is still allowed by policy_after.
5. Every constraint still holds, and the summary/rationale honestly describe the diff.
Otherwise REJECT. If in doubt, REJECT.

OUTPUT: reply with ONLY one JSON object and nothing else (no prose, no code fences):
{"decision":"approve"|"reject","reasons":["short reason", ...]}
Give 1-5 short reasons. For a reject, name the exact statement and permission at fault.
Do not call any tools; everything you need is in the input.`;

const DESCRIPTION =
  "Independent reviewer for CloseLoop: checks that a proposed least-privilege policy change fixes the finding without widening access or breaking required checks. Replies with a JSON verdict.";

const promptHash = createHash("sha256").update(SYSTEM_PROMPT).digest("hex").slice(0, 12);
const MARKER = `prompt:${promptHash}`;

function authHeader() {
  const key = process.env.GUILD_AI_API_KEY;
  if (!key || !key.includes(":")) throw new Error("GUILD_AI_API_KEY is missing or not '<key_id>:<secret>'");
  return "Basic " + Buffer.from(key).toString("base64");
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: authHeader(), accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, ok: res.ok, json, text };
}

async function must(method, path, body) {
  const r = await api(method, path, body);
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${r.text.slice(0, 400)}`);
  return r.json;
}

async function listAll(path) {
  const items = [];
  for (let offset = 0; ; offset += 100) {
    const sep = path.includes("?") ? "&" : "?";
    const page = await must("GET", `${path}${sep}limit=100&offset=${offset}`);
    items.push(...(page.items || []));
    if (!page.pagination?.has_more) return items;
  }
}

const statusOf = (v) => (typeof v.status === "string" ? v.status : v.status?.name || v.status?.value || JSON.stringify(v.status));
const isPublished = (v) => Boolean(v.published_at) || /PUBLISHED/i.test(String(statusOf(v)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bump(versions) {
  let max = [0, 0, 0];
  for (const v of versions) {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.version_number || "");
    if (!m) continue;
    const n = m.slice(1).map(Number);
    if (n[0] > max[0] || (n[0] === max[0] && (n[1] > max[1] || (n[1] === max[1] && n[2] > max[2])))) max = n;
  }
  return max.every((x) => x === 0) ? "1.0.0" : `${max[0]}.${max[1]}.${max[2] + 1}`;
}

async function main() {
  const me = await must("GET", "/me");
  const owner = me.owner;
  console.log(`account: ${owner.name} (${owner.id})`);

  // 1. workspace
  const workspaces = await listAll(`/accounts/${encodeURIComponent(owner.name)}/workspaces`);
  let ws = workspaces.find((w) => w.name === WORKSPACE);
  if (ws) console.log(`workspace: exists ${ws.name} (${ws.id})`);
  else {
    ws = await must("POST", "/workspaces", { name: WORKSPACE, owner_id: owner.id });
    console.log(`workspace: created ${ws.name} (${ws.id})`);
  }

  // 2. agent
  let agent;
  const got = await api("GET", `/agents/${encodeURIComponent(`${owner.name}~${AGENT}`)}`);
  if (got.ok) {
    agent = got.json;
    console.log(`agent: exists ${agent.full_name || AGENT} (${agent.id})`);
  } else if (got.status === 404) {
    agent = await must("POST", "/agents", { name: AGENT, description: DESCRIPTION, owner_id: owner.id, template: "LLM", is_public: false });
    console.log(`agent: created ${agent.full_name || AGENT} (${agent.id})`);
  } else throw new Error(`GET agent -> ${got.status}: ${got.text.slice(0, 300)}`);

  // A freshly created agent is provisioned asynchronously; configure-llm 409s until READY.
  for (let i = 0; agent.status !== "READY"; i++) {
    if (i >= 60) throw new Error(`agent never became READY (status ${agent.status})`);
    await sleep(2000);
    agent = await must("GET", `/agents/${agent.id}`);
  }

  // 3. version with the current prompt, published
  let versions = await listAll(`/agents/${agent.id}/versions`);
  let version = versions.find((v) => (v.summary || "").includes(MARKER));
  if (version) console.log(`version: ${version.version_number} already carries ${MARKER}`);
  else {
    const version_number = bump(versions);
    version = await must("POST", `/agents/${agent.id}/configure-llm`, {
      system_prompt: SYSTEM_PROMPT,
      description: DESCRIPTION,
      tools: [],
      // Guild requires at least one tool; this read-only agent-search tool is the minimum.
      // The prompt tells the reviewer never to call it.
      guild_tools: ["guild_search_agent"],
      mode: "one-shot",
      summary: `closeloop-reviewer ${MARKER}`,
      version_number,
    });
    console.log(`version: configured ${version.version_number} (${version.id})`);
  }

  // configure-llm may publish on its own; re-read the version for its real state.
  const refresh = async () => {
    versions = await listAll(`/agents/${agent.id}/versions`);
    version = versions.find((v) => v.id === version.id) || version;
  };
  await refresh();
  if (!isPublished(version)) {
    // Wait for validation to settle before publishing.
    for (let i = 0; i < 30 && /PENDING|RUNNING/.test(version.validation_status || ""); i++) {
      await sleep(2000);
      await refresh();
    }
    const alreadyPublished = (r) => r.status === 409 && /already published/i.test(r.text);
    let pub = await api("POST", `/versions/${version.id}/publish`, { force_publish: false });
    if (!pub.ok && !alreadyPublished(pub)) {
      console.log(`publish: ${pub.status} ${pub.text.slice(0, 200)} — retrying with force_publish`);
      pub = await api("POST", `/versions/${version.id}/publish`, { force_publish: true });
      if (!pub.ok && !alreadyPublished(pub)) throw new Error(`publish -> ${pub.status}: ${pub.text.slice(0, 400)}`);
    }
    await refresh();
    if (!isPublished(version)) throw new Error(`version ${version.id} is not published (status ${statusOf(version)})`);
    console.log(`version: published ${version.version_number} (${version.id})`);
  } else console.log(`version: ${version.version_number} is published (${version.id})`);

  // 4. install in workspace
  const installed = await listAll(`/workspaces/${ws.id}/workspace_agents`);
  const wa = installed.find((x) => x.agent?.id === agent.id || x.agent_version?.agent_id === agent.id);
  if (wa) console.log(`install: already in workspace (${wa.id})`);
  else {
    const added = await must("POST", `/workspaces/${ws.id}/workspace_agents`, { agent_id: agent.id, should_autoupdate: true });
    console.log(`install: added to workspace (${added.id})`);
  }

  console.log("\nAdd these (non-secret) lines to .env:");
  console.log(`GUILD_OWNER=${owner.name}`);
  console.log(`GUILD_WORKSPACE=${ws.name}`); // sessions API path is <owner>~<workspace> (a UUID also works)
  console.log(`GUILD_REVIEWER_AGENT=${agent.id}`); // chat sessions need the agent UUID
}

main().catch((err) => {
  console.error("guild-setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
