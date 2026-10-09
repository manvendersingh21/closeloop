import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { ExploitHandoffV1 } from "@/contracts/handoff";
import type {
  CheckResult,
  ExecutionReport,
  PatchProposal,
  PolicyDocument,
  ReviewVerdict,
} from "@/contracts/internal";
import { applyPolicyToSdl, createShipper, labPolicyJson } from "./ship";

const TOKEN = "ghp_test-token";
const REPO = "acme/infra";
const ENV = { GITHUB_TOKEN: TOKEN, CLOSELOOP_PR_REPO: REPO };
const API = "https://api.github.com";
const BRANCH = "closeloop/find-002-job-42";
const PR_URL = "https://github.com/acme/infra/pull/7";
const SDL_PATH = "lab/akash/lab-api.sdl.yaml";
const BASELINE_SDL = `services:
  lab-api:
    env:
      - WORKLOAD_TOKEN=<WORKLOAD_TOKEN>
      - 'POLICY_JSON={"statements":[{"sid":"BroadRead","effect":"allow","actions":["data:read"],"resources":["*"]}]}'
`;

const handoff = ExploitHandoffV1.parse(
  JSON.parse(readFileSync(path.join(__dirname, "../../../contracts/examples/FIND-002.akash.handoff.json"), "utf8")),
);

const BEFORE: PolicyDocument = {
  Version: "2012-10-17",
  Statement: [
    { Sid: "BroadRead", Effect: "Allow", Action: ["data:read"], Resource: ["*"] },
    { Sid: "OrdersWrite", Effect: "Allow", Action: ["orders:write"], Resource: ["orders"] },
  ],
};
const AFTER: PolicyDocument = {
  Version: "2012-10-17",
  Statement: [
    { Sid: "AppRead", Effect: "Allow", Action: ["data:read"], Resource: ["app/*"] },
    { Sid: "OrdersWrite", Effect: "Allow", Action: ["orders:write"], Resource: ["orders"] },
  ],
};

const checks: CheckResult[] = [
  { check_id: "neg-canary-read", phase: "baseline", attempt: 1, expected: "deny", actual: "allow", passed: false, detail: "exploit reproduced live" },
  { check_id: "neg-canary-read", phase: "live", attempt: 1, expected: "deny", actual: "deny", passed: true, detail: "GET /data/canary/secret.txt → 403" },
  { check_id: "pos-orders-write|typo", phase: "live", attempt: 1, expected: "allow", actual: "allow", passed: true, detail: "line one\nline two" },
];

const proposal: PatchProposal = {
  attempt: 1,
  policyBefore: BEFORE,
  policyAfter: AFTER,
  summary: ["Scope data:read to app/* instead of *", "Keep OrdersWrite untouched"],
  rationale: "Smallest change that blocks the canary while preserving legitimate app traffic.",
  simulated: [],
};

const report: ExecutionReport = {
  status: "verified",
  checks,
  exploitBefore: "success",
  exploitAfter: "blocked",
  error: null,
};

const review: ReviewVerdict = {
  decision: "approve",
  reasons: ["minimal blast radius", "canary blocked"],
  sessionUrl: "https://guild.example/sessions/abc",
};

const input = { handoff, proposal, report, jobId: "job-42", review };

type Recorded = { method: string; url: string; headers: Record<string, string>; body?: Record<string, unknown> };
type Reply = { status: number; json: unknown };

function fakeGitHub(respond: (call: Recorded) => Reply) {
  const calls: Recorded[] = [];
  const mocked = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call: Recorded = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>),
    };
    calls.push(call);
    const reply = respond(call);
    return { status: reply.status, statusText: `HTTP ${reply.status}`, json: async () => reply.json } as unknown as Response;
  });
  return { fetch: mocked as unknown as typeof fetch, calls };
}

function happyRoute(call: Recorded): Reply {
  const { method, url } = call;
  if (method === "GET" && url === `${API}/repos/${REPO}/git/ref/heads/main`) return { status: 200, json: { object: { sha: "sha-base" } } };
  if (method === "POST" && url === `${API}/repos/${REPO}/git/refs`) return { status: 201, json: {} };
  if (method === "GET" && url.includes(`/contents/${SDL_PATH}`)) {
    return {
      status: 200,
      json: { sha: "sha-sdl", content: Buffer.from(BASELINE_SDL, "utf8").toString("base64") },
    };
  }
  if (method === "GET" && url.includes("/contents/")) return { status: 404, json: { message: "Not Found" } };
  if (method === "PUT" && url.includes("/contents/")) return { status: 201, json: { content: {} } };
  if (method === "POST" && url.endsWith("/pulls")) return { status: 201, json: { html_url: PR_URL } };
  throw new Error(`unexpected request ${method} ${url}`);
}

const failRoute = (): Reply => {
  throw new Error("fetch must not be called");
};

function bodyOf(call: Recorded | undefined): Record<string, unknown> {
  expect(call).toBeDefined();
  return call?.body ?? {};
}

const decode = (b64: unknown) => Buffer.from(String(b64), "base64").toString("utf8");

describe("applyPolicyToSdl / labPolicyJson", () => {
  it("rewrites only the POLICY_JSON env line", () => {
    const json = labPolicyJson(AFTER);
    const next = applyPolicyToSdl(BASELINE_SDL, json);
    expect(next).toContain("WORKLOAD_TOKEN=<WORKLOAD_TOKEN>");
    expect(next).toContain(`POLICY_JSON=${json}`);
    expect(next).not.toContain('"resources":["*"]');
    expect(() => applyPolicyToSdl("no policy here\n", json)).toThrow(/POLICY_JSON/);
  });
});

describe("shipFix", () => {
  it("is disabled without any network call when config is missing", async () => {
    const noToken = fakeGitHub(failRoute);
    const r1 = await createShipper({ fetch: noToken.fetch, env: { CLOSELOOP_PR_REPO: REPO } })(input);
    expect(r1).toEqual({ prUrl: null, error: "PR shipping disabled: GITHUB_TOKEN missing" });
    expect(noToken.calls).toHaveLength(0);

    const noRepo = fakeGitHub(failRoute);
    const r2 = await createShipper({ fetch: noRepo.fetch, env: { GITHUB_TOKEN: TOKEN } })(input);
    expect(r2).toEqual({ prUrl: null, error: "PR shipping disabled: CLOSELOOP_PR_REPO missing" });
    expect(noRepo.calls).toHaveLength(0);
  });

  it("refuses to ship a report that is not verified", async () => {
    const gh = fakeGitHub(failRoute);
    const r = await createShipper({ fetch: gh.fetch, env: ENV })({ ...input, report: { ...report, status: "rolled_back" } });
    expect(r).toEqual({ prUrl: null, error: "not shipped: status rolled_back" });
    expect(gh.calls).toHaveLength(0);
  });

  it("happy path: base sha → branch → 3 files → SDL POLICY_JSON → PR with the right requests in order", async () => {
    const gh = fakeGitHub(happyRoute);
    const r = await createShipper({ fetch: gh.fetch, env: ENV })(input);
    expect(r).toEqual({ prUrl: PR_URL, error: null });

    expect(gh.calls).toHaveLength(11);
    const reqs = gh.calls.map((c) => c.url);
    expect(reqs[0]).toBe(`${API}/repos/${REPO}/git/ref/heads/main`);
    expect(reqs[1]).toBe(`${API}/repos/${REPO}/git/refs`);
    expect(reqs[2]).toBe(`${API}/repos/${REPO}/contents/remediations/FIND-002/policy.after.json?ref=${encodeURIComponent(BRANCH)}`);
    expect(reqs[3]).toBe(`${API}/repos/${REPO}/contents/remediations/FIND-002/policy.after.json`);
    expect(reqs[4]).toBe(`${API}/repos/${REPO}/contents/remediations/FIND-002/policy.before.json?ref=${encodeURIComponent(BRANCH)}`);
    expect(reqs[5]).toBe(`${API}/repos/${REPO}/contents/remediations/FIND-002/policy.before.json`);
    expect(reqs[6]).toBe(`${API}/repos/${REPO}/contents/remediations/FIND-002/EVIDENCE.md?ref=${encodeURIComponent(BRANCH)}`);
    expect(reqs[7]).toBe(`${API}/repos/${REPO}/contents/remediations/FIND-002/EVIDENCE.md`);
    expect(reqs[8]).toBe(`${API}/repos/${REPO}/contents/${SDL_PATH}?ref=${encodeURIComponent(BRANCH)}`);
    expect(reqs[9]).toBe(`${API}/repos/${REPO}/contents/${SDL_PATH}`);
    expect(reqs[10]).toBe(`${API}/repos/${REPO}/pulls`);

    for (const c of gh.calls) {
      expect(c.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(c.headers.accept).toBe("application/vnd.github+json");
      expect(c.headers["x-github-api-version"]).toBe("2022-11-28");
      expect(c.headers["user-agent"]).toBe("closeloop");
    }

    expect(bodyOf(gh.calls[1])).toEqual({ ref: `refs/heads/${BRANCH}`, sha: "sha-base" });

    const afterPut = bodyOf(gh.calls[3]);
    expect(afterPut.branch).toBe(BRANCH);
    expect(afterPut.sha).toBeUndefined();
    expect(JSON.parse(decode(afterPut.content))).toEqual(AFTER);

    const beforePut = bodyOf(gh.calls[5]);
    expect(beforePut.branch).toBe(BRANCH);
    expect(JSON.parse(decode(beforePut.content))).toEqual(BEFORE);

    const evidence = decode(bodyOf(gh.calls[7]).content);
    expect(evidence).toContain(handoff.title);
    expect(evidence).toContain(`**Severity:** ${handoff.severity}`);
    expect(evidence).toContain("**success**");
    expect(evidence).toContain("**blocked**");
    expect(evidence).toContain("| check_id | phase | expected | actual | passed | detail |");
    expect(evidence).toContain("| neg-canary-read | live | deny | deny | true |");
    expect(evidence).toContain("pos-orders-write\\|typo");
    expect(evidence).toContain("line one line two");
    expect(evidence).toContain("- Scope data:read to app/* instead of *");
    expect(evidence).toContain(proposal.rationale);
    expect(evidence).toContain("**approve**");
    expect(evidence).toContain("- minimal blast radius");
    expect(evidence).toContain(review.sessionUrl);
    expect(evidence).toContain("`job-42`");

    const sdlPut = bodyOf(gh.calls[9]);
    expect(sdlPut.branch).toBe(BRANCH);
    expect(sdlPut.sha).toBe("sha-sdl");
    const sdlText = decode(sdlPut.content);
    expect(sdlText).toContain("WORKLOAD_TOKEN=<WORKLOAD_TOKEN>");
    expect(sdlText).toContain(`POLICY_JSON=${labPolicyJson(AFTER)}`);

    const pr = bodyOf(gh.calls[10]);
    expect(pr.title).toBe(`fix(FIND-002): ${handoff.title}`);
    expect(pr.head).toBe(BRANCH);
    expect(pr.base).toBe("main");
    expect(pr.body).toContain("success → blocked");
    expect(pr.body).toContain("2/3");
    expect(pr.body).toContain(SDL_PATH);
    expect(pr.body).toContain(review.sessionUrl);
    expect(pr.body).toContain("Verified live by CloseLoop before this PR was opened.");
  });

  it("reuses an existing branch (422 on create ref) and still opens the PR", async () => {
    const gh = fakeGitHub((call) => {
      if (call.method === "POST" && call.url.endsWith("/git/refs")) {
        return { status: 422, json: { message: "Reference already exists" } };
      }
      if (call.method === "GET" && call.url.includes("EVIDENCE.md")) {
        return { status: 200, json: { sha: "sha-evidence" } };
      }
      return happyRoute(call);
    });
    const r = await createShipper({ fetch: gh.fetch, env: ENV })(input);
    expect(r).toEqual({ prUrl: PR_URL, error: null });

    const evidencePut = bodyOf(gh.calls.find((c) => c.method === "PUT" && c.url.includes("EVIDENCE.md")));
    expect(evidencePut.sha).toBe("sha-evidence");
    expect(evidencePut.branch).toBe(BRANCH);
    expect(gh.calls.filter((c) => c.method === "POST" && c.url.endsWith("/pulls"))).toHaveLength(1);
  });

  it("returns a step error without the token when the API fails", async () => {
    const gh = fakeGitHub((call) => {
      if (call.method === "GET" && call.url.endsWith("/git/ref/heads/main")) {
        return { status: 500, json: { message: "Internal Error" } };
      }
      return happyRoute(call);
    });
    const r = await createShipper({ fetch: gh.fetch, env: ENV })(input);
    expect(r.prUrl).toBeNull();
    expect(r.error).toBe("get base ref: 500 Internal Error");
    expect(r.error).not.toContain(TOKEN);
    expect(gh.calls).toHaveLength(1);
  });
});
