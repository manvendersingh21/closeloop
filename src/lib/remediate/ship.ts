// A2 shipper: open a GitHub pull request that carries the verified policy diff
// and the live evidence, so a human can review and merge the fix. Never throws.
import type { CheckResult, PolicyDocument, ShipFix, ShipResult } from "@/contracts/internal";
import { toLabPolicy } from "@/lib/lab";

const GITHUB_API = "https://api.github.com";
const TIMEOUT_MS = 20_000;
const SDL_PATH = "lab/akash/lab-api.sdl.yaml";

export interface ShipperDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
}

type ShipInput = Parameters<ShipFix>[0];
type GhResponse = { status: number; statusText: string; json: Record<string, unknown> | null };

/** Markdown table cell: neutralize pipes and flatten newlines. */
function escCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function checksTable(checks: CheckResult[]): string {
  const rows = checks.map(
    (c) =>
      `| ${escCell(c.check_id)} | ${c.phase} | ${c.expected} | ${c.actual} | ${c.passed} | ${escCell(c.detail ?? "")} |`,
  );
  return [
    "| check_id | phase | expected | actual | passed | detail |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function evidenceMd({ handoff, proposal, report, jobId, review }: ShipInput): string {
  const out: string[] = [
    `# ${handoff.finding_id}: remediation evidence`,
    "",
    `**Finding:** ${handoff.title}`,
    `**Severity:** ${handoff.severity}`,
    "",
    "## Exploit replay",
    "",
    `- Before the fix: **${report.exploitBefore}**`,
    `- After the fix: **${report.exploitAfter}**`,
    "",
    "## Verification checks",
    "",
    checksTable(report.checks),
    "",
    "## Change summary",
    "",
    ...proposal.summary.map((s) => `- ${s}`),
    "",
    "## Rationale",
    "",
    proposal.rationale,
    "",
    "## Independent review",
    "",
  ];
  if (review) {
    out.push(`Decision: **${review.decision}**`, "");
    out.push(...review.reasons.map((r) => `- ${r}`), "");
    if (review.sessionUrl) out.push(`Guild review session: ${review.sessionUrl}`, "");
  } else {
    out.push("_No independent review recorded._", "");
  }
  out.push(`Job: \`${jobId}\``, "");
  return out.join("\n");
}

function prBody({ proposal, report, review }: ShipInput): string {
  const passed = report.checks.filter((c) => c.passed).length;
  const out: string[] = ["## Summary", "", ...proposal.summary.map((s) => `- ${s}`), ""];
  out.push(`Exploit replay: ${report.exploitBefore} → ${report.exploitAfter} after the fix.`, "");
  out.push(`Checks: ${passed}/${report.checks.length} passed.`);
  out.push("", `Also updates \`${SDL_PATH}\` \`POLICY_JSON\` to the verified lab policy.`);
  if (review?.sessionUrl) out.push("", `Independent review: ${review.sessionUrl}`);
  out.push("", "Verified live by CloseLoop before this PR was opened.");
  return out.join("\n");
}

/** Compact lab POLICY_JSON for the SDL env line (no spaces). */
export function labPolicyJson(policy: PolicyDocument): string {
  return JSON.stringify(toLabPolicy(policy));
}

/**
 * Replace only the POLICY_JSON=... assignment on its env line.
 * Leaves WORKLOAD_TOKEN and every other line untouched.
 */
export function applyPolicyToSdl(sdl: string, policyJson: string): string {
  let found = false;
  const out = sdl.split("\n").map((line) => {
    const m = line.match(/^(\s*-\s*')POLICY_JSON=.*(')\s*$/);
    if (!m) return line;
    found = true;
    return `${m[1]}POLICY_JSON=${policyJson}${m[2]}`;
  });
  if (!found) {
    throw new Error(`${SDL_PATH}: POLICY_JSON env line not found`);
  }
  return out.join("\n");
}

export function createShipper(deps: ShipperDeps): ShipFix {
  return async (input): Promise<ShipResult> => {
    const disabled = (vars: string): ShipResult => ({ prUrl: null, error: `PR shipping disabled: ${vars} missing` });

    const token = deps.env.GITHUB_TOKEN?.trim();
    if (!token) return disabled("GITHUB_TOKEN");
    const repo = deps.env.CLOSELOOP_PR_REPO?.trim();
    if (!repo) return disabled("CLOSELOOP_PR_REPO");
    const parts = repo.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return disabled("CLOSELOOP_PR_REPO");
    const [owner, name] = parts;
    const base = deps.env.CLOSELOOP_PR_BASE?.trim() || "main";

    if (input.report.status !== "verified") {
      return { prUrl: null, error: `not shipped: status ${input.report.status}` };
    }

    const redact = (msg: string) => msg.split(token).join("***").slice(0, 200);

    const gh = async (path: string, init: { method?: string; body?: unknown } = {}): Promise<GhResponse> => {
      const res = await deps.fetch(GITHUB_API + path, {
        method: init.method ?? "GET",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "closeloop",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      let json: Record<string, unknown> | null = null;
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch {
        // empty or non-JSON body
      }
      return { status: res.status, statusText: res.statusText, json };
    };

    const failure = (step: string, res: GhResponse): ShipResult => {
      const msg = res.json !== null && typeof res.json.message === "string" ? res.json.message : res.statusText;
      return { prUrl: null, error: `${step}: ${res.status} ${redact(msg)}` };
    };

    const { handoff, proposal, jobId } = input;
    const branch = `closeloop/${handoff.finding_id.toLowerCase()}-${jobId}`;
    const api = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
    const files = [
      {
        path: `remediations/${handoff.finding_id}/policy.after.json`,
        content: `${JSON.stringify(proposal.policyAfter, null, 2)}\n`,
      },
      {
        path: `remediations/${handoff.finding_id}/policy.before.json`,
        content: `${JSON.stringify(proposal.policyBefore, null, 2)}\n`,
      },
      { path: `remediations/${handoff.finding_id}/EVIDENCE.md`, content: evidenceMd(input) },
    ];

    let step = "get base ref";
    try {
      const ref = await gh(`${api}/git/ref/heads/${enc(base)}`);
      if (ref.status !== 200) return failure(step, ref);
      const baseSha = (ref.json?.object as { sha?: string } | undefined)?.sha;
      if (!baseSha) return { prUrl: null, error: `${step}: 200 response had no sha` };

      step = "create branch";
      const created = await gh(`${api}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha: baseSha } });
      // 422 = this job's branch already exists; reuse it and update files in place.
      if (created.status !== 201 && created.status !== 422) return failure(step, created);

      for (const file of files) {
        step = `read ${file.path}`;
        const existing = await gh(`${api}/contents/${enc(file.path)}?ref=${encodeURIComponent(branch)}`);
        if (existing.status !== 200 && existing.status !== 404) return failure(step, existing);
        const fileSha = existing.status === 200 && typeof existing.json?.sha === "string" ? existing.json.sha : undefined;

        step = `write ${file.path}`;
        const put = await gh(`${api}/contents/${enc(file.path)}`, {
          method: "PUT",
          body: {
            message: `closeloop: ${fileSha === undefined ? "add" : "update"} ${file.path} (${jobId})`,
            content: Buffer.from(file.content, "utf8").toString("base64"),
            branch,
            ...(fileSha === undefined ? {} : { sha: fileSha }),
          },
        });
        if (put.status !== 200 && put.status !== 201) return failure(step, put);
      }

      // Update only POLICY_JSON in the infra SDL so merge = deployable verified policy.
      step = `read ${SDL_PATH}`;
      const sdlRes = await gh(`${api}/contents/${enc(SDL_PATH)}?ref=${encodeURIComponent(branch)}`);
      if (sdlRes.status !== 200) return failure(step, sdlRes);
      const sdlSha = typeof sdlRes.json?.sha === "string" ? sdlRes.json.sha : undefined;
      const encoded = typeof sdlRes.json?.content === "string" ? sdlRes.json.content : "";
      if (!sdlSha || !encoded) return { prUrl: null, error: `${step}: missing sha or content` };
      const currentSdl = Buffer.from(encoded.replace(/\n/g, ""), "base64").toString("utf8");
      let nextSdl: string;
      try {
        nextSdl = applyPolicyToSdl(currentSdl, labPolicyJson(proposal.policyAfter));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { prUrl: null, error: `${step}: ${msg}` };
      }
      if (nextSdl !== currentSdl) {
        step = `write ${SDL_PATH}`;
        const putSdl = await gh(`${api}/contents/${enc(SDL_PATH)}`, {
          method: "PUT",
          body: {
            message: `closeloop: update POLICY_JSON for ${handoff.finding_id} (${jobId})`,
            content: Buffer.from(nextSdl, "utf8").toString("base64"),
            branch,
            sha: sdlSha,
          },
        });
        if (putSdl.status !== 200 && putSdl.status !== 201) return failure(step, putSdl);
      }

      step = "open pull request";
      const pr = await gh(`${api}/pulls`, {
        method: "POST",
        body: {
          title: `fix(${handoff.finding_id}): ${handoff.title}`,
          head: branch,
          base,
          body: prBody(input),
        },
      });
      if (pr.status !== 201) return failure(step, pr);
      const htmlUrl = pr.json !== null && typeof pr.json.html_url === "string" ? pr.json.html_url : "";
      if (!htmlUrl) return { prUrl: null, error: `${step}: 201 response had no html_url` };
      return { prUrl: htmlUrl, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { prUrl: null, error: `${step}: ${redact(msg)}` };
    }
  };
}

export const shipFix: ShipFix = createShipper({ fetch, env: process.env });
