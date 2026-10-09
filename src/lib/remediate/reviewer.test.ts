import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ExploitHandoffV1 } from "@/contracts/handoff";
import type { PatchProposal, PolicyDocument } from "@/contracts/internal";
import { createGuildClient, extractFinalOutput, type GuildClient } from "@/lib/guild";
import { buildReviewInput, createReviewer, parseVerdict } from "./reviewer";

const handoff = ExploitHandoffV1.parse(
  JSON.parse(readFileSync(path.resolve(__dirname, "../../../contracts/examples/FIND-002.akash.handoff.json"), "utf8")),
);

const before: PolicyDocument = {
  Version: "2012-10-17",
  Statement: [
    { Sid: "BroadRead", Effect: "Allow", Action: ["data:read"], Resource: ["*"] },
    { Sid: "OrdersWrite", Effect: "Allow", Action: ["orders:write"], Resource: ["orders"] },
  ],
};
const proposal: PatchProposal = {
  attempt: 1,
  policyBefore: before,
  policyAfter: {
    Version: "2012-10-17",
    Statement: [
      { Sid: "BroadRead", Effect: "Allow", Action: ["data:read"], Resource: ["app/*"] },
      { Sid: "OrdersWrite", Effect: "Allow", Action: ["orders:write"], Resource: ["orders"] },
    ],
  },
  summary: ["Scope BroadRead data:read from * to app/*"],
  rationale: "Removes canary access while keeping app reads and order writes.",
  simulated: [],
};

const ENV = {
  GUILD_AI_API_KEY: "kid:very-secret",
  GUILD_OWNER: "acme",
  GUILD_WORKSPACE: "closeloop",
  GUILD_REVIEWER_AGENT: "11111111-2222-3333-4444-555555555555",
};
const SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SESSION_URL = `https://app.guild.ai/sessions/${SESSION_ID}`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake Guild API: session finishes after `pendingPolls` GETs and replies with `reply`. */
function fakeGuild(reply: string | null, opts: { pendingPolls?: number; neverFinish?: boolean } = {}) {
  let polls = 0;
  const calls: { method: string; url: string; body?: unknown; auth?: string }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers.authorization });
    if (method === "POST" && u.endsWith("/sessions"))
      return json(201, { id: SESSION_ID, session_url: SESSION_URL, root_task: { status: "CREATED" } });
    if (u.includes("/events"))
      return json(200, {
        items: [
          { id: "3", type: "runtime_done", created_at: "2026-10-09T00:00:03Z", content: reply === null ? {} : { text: reply, type: "text" } },
          { id: "2", type: "runtime_done", created_at: "2026-10-09T00:00:02Z", content: {} },
          { id: "1", type: "user_message", created_at: "2026-10-09T00:00:01Z", content: "{}" },
        ],
      });
    if (u.includes(`/sessions/${SESSION_ID}`)) {
      polls++;
      const done = !opts.neverFinish && polls > (opts.pendingPolls ?? 0);
      return json(200, { id: SESSION_ID, root_task: { status: done ? "DONE" : "RUNNING" } });
    }
    return json(404, { error: "NotFound" });
  });
  const makeClient = (cfg: Parameters<typeof createGuildClient>[0]): GuildClient =>
    createGuildClient(cfg, fetchMock as unknown as typeof fetch);
  return { fetchMock, calls, makeClient };
}

describe("reviewProposal (Guild reviewer)", () => {
  it("approves, sending the proposal as a chat session and returning the session link", async () => {
    const g = fakeGuild('{"decision":"approve","reasons":["BroadRead narrowed to app/*","OrdersWrite unchanged"]}', {
      pendingPolls: 2,
    });
    const review = createReviewer({ env: ENV, makeClient: g.makeClient, pollMs: 1, timeoutMs: 5_000 });
    const v = await review(handoff, proposal, "job-1");
    expect(v).toEqual({
      decision: "approve",
      reasons: ["BroadRead narrowed to app/*", "OrdersWrite unchanged"],
      sessionUrl: SESSION_URL,
    });

    const start = g.calls[0];
    expect(start.url).toBe("https://api.guild.ai/v1/workspaces/acme~closeloop/sessions");
    expect(start.auth).toBe("Basic " + Buffer.from(ENV.GUILD_AI_API_KEY).toString("base64"));
    const body = start.body as { session_type: string; agent_id: string; initial_prompt: string };
    expect(body.session_type).toBe("chat");
    expect(body.agent_id).toBe(ENV.GUILD_REVIEWER_AGENT);
    const input = JSON.parse(body.initial_prompt);
    expect(input).toEqual(buildReviewInput(handoff, proposal));
    expect(input.policy_after.Statement[0].Resource).toEqual(["app/*"]);
    expect(input.checks).toHaveLength(4);
    expect(input.finding.exploit).toEqual({ action: "data:read", resource: "canary/secret.txt" });
  });

  it("rejects with reasons, tolerating code fences and prose", async () => {
    const reply = 'Here is my review:\n```json\n{"decision": "Reject", "reasons": ["OrdersWrite gained *"]}\n```';
    const g = fakeGuild(reply);
    const v = await createReviewer({ env: ENV, makeClient: g.makeClient, pollMs: 1 })(handoff, proposal, "job-2");
    expect(v).toEqual({ decision: "reject", reasons: ["OrdersWrite gained *"], sessionUrl: SESSION_URL });
  });

  it("times out → unavailable, keeping the session link", async () => {
    const g = fakeGuild('{"decision":"approve","reasons":[]}', { neverFinish: true });
    const v = await createReviewer({ env: ENV, makeClient: g.makeClient, pollMs: 5, timeoutMs: 60 })(handoff, proposal, "job-3");
    expect(v.decision).toBe("unavailable");
    expect(v.reasons[0]).toMatch(/timed out|did not finish/);
    expect(v.sessionUrl).toBe(SESSION_URL);
  });

  it("malformed reply → unavailable", async () => {
    const g = fakeGuild("I think this looks fine overall!");
    const v = await createReviewer({ env: ENV, makeClient: g.makeClient, pollMs: 1 })(handoff, proposal, "job-4");
    expect(v.decision).toBe("unavailable");
    expect(v.reasons[0]).toMatch(/not a valid verdict/);
    expect(v.sessionUrl).toBe(SESSION_URL);
  });

  it("unknown decision value → unavailable", async () => {
    const g = fakeGuild('{"decision":"maybe","reasons":["unsure"]}');
    const v = await createReviewer({ env: ENV, makeClient: g.makeClient, pollMs: 1 })(handoff, proposal, "job-5");
    expect(v.decision).toBe("unavailable");
  });

  it("missing config → unavailable without calling Guild", async () => {
    const g = fakeGuild('{"decision":"approve","reasons":[]}');
    const v = await createReviewer({ env: { ...ENV, GUILD_REVIEWER_AGENT: "", GUILD_OWNER: undefined }, makeClient: g.makeClient })(
      handoff,
      proposal,
      "job-6",
    );
    expect(v).toEqual({
      decision: "unavailable",
      reasons: [expect.stringContaining("GUILD_OWNER, GUILD_REVIEWER_AGENT")],
      sessionUrl: null,
    });
    expect(g.fetchMock).not.toHaveBeenCalled();
  });

  it("API error → unavailable, never leaking the key", async () => {
    const fetchMock = vi.fn(async () => json(403, { error: "Forbidden", message: "no access" }));
    const v = await createReviewer({
      env: ENV,
      makeClient: (cfg) => createGuildClient(cfg, fetchMock as unknown as typeof fetch),
    })(handoff, proposal, "job-7");
    expect(v.decision).toBe("unavailable");
    expect(v.reasons[0]).toMatch(/403.*Forbidden/);
    expect(JSON.stringify(v)).not.toContain("very-secret");
  });
});

describe("parseVerdict / extractFinalOutput", () => {
  it("parses bare, fenced and embedded JSON", () => {
    expect(parseVerdict('{"decision":"approve","reasons":["ok"]}')).toEqual({ decision: "approve", reasons: ["ok"] });
    expect(parseVerdict('Verdict: {"decision":"reject","reasons":"widens"} done')).toEqual({
      decision: "reject",
      reasons: ["widens"],
    });
    expect(parseVerdict("nope")).toBeNull();
  });

  it("takes the newest runtime_done text, falling back to the notification message", () => {
    expect(
      extractFinalOutput([
        { type: "runtime_done", created_at: "2026-01-01T00:00:01Z", content: { text: "old" } },
        { type: "runtime_done", created_at: "2026-01-01T00:00:02Z", content: { text: "new" } },
        { type: "runtime_done", created_at: "2026-01-01T00:00:03Z", content: {} },
      ]),
    ).toBe("new");
    expect(
      extractFinalOutput([{ type: "agent_notification_message", created_at: "2026-01-01T00:00:01Z", content: { data: "x", type: "text" } }]),
    ).toBe("x");
    expect(extractFinalOutput([])).toBeNull();
  });
});
