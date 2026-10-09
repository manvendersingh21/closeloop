// Minimal Guild.ai REST client (https://docs.guild.ai/api-reference).
// Auth: GUILD_AI_API_KEY = "<key_id>:<secret>" sent as HTTP Basic. Errors never include the key.
//
// An *account* key may only start `chat` sessions (`api_trigger` is 403 for account keys; trigger
// keys can only be minted in the web UI), so the reviewer's input goes in as the chat's
// `initial_prompt` (a JSON string) and the agent's reply comes back as a `runtime_done` event
// whose `content.text` carries the message.

export interface GuildConfig {
  apiKey: string;
  /** Account name that owns the workspace, e.g. "manvendersingh21". */
  owner: string;
  /** Workspace name (combined with owner as "<owner>~<name>") or workspace UUID. */
  workspace: string;
  /** Agent UUID installed in the workspace. */
  agentId: string;
  baseUrl: string;
}

export interface GuildSession {
  id: string;
  sessionUrl: string | null;
  status: string | null;
}

export interface WaitResult {
  status: string;
}

export interface GuildClient {
  startSession(input: unknown, agentId?: string): Promise<GuildSession>;
  /** Resolves once the root task finished (or a final reply exists); throws on ERROR/INTERRUPTED/timeout. */
  waitForSession(id: string, opts?: { timeoutMs?: number; pollMs?: number }): Promise<WaitResult>;
  /** The agent's final reply text, or null if there is none yet. */
  getFinalOutput(id: string): Promise<string | null>;
}

const REQUEST_TIMEOUT_MS = 30_000;
const TERMINAL = new Set(["DONE", "ERROR", "INTERRUPTED"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ENV_KEYS = ["GUILD_AI_API_KEY", "GUILD_OWNER", "GUILD_WORKSPACE", "GUILD_REVIEWER_AGENT"] as const;

/** Reads Guild config from the environment; lists what is missing instead of throwing. */
export function guildConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): { config: GuildConfig; missing: [] } | { config: null; missing: string[] } {
  const missing = ENV_KEYS.filter((k) => !env[k]?.trim());
  if (missing.length) return { config: null, missing };
  return {
    config: {
      apiKey: env.GUILD_AI_API_KEY!.trim(),
      owner: env.GUILD_OWNER!.trim(),
      workspace: env.GUILD_WORKSPACE!.trim(),
      agentId: env.GUILD_REVIEWER_AGENT!.trim(),
      baseUrl: (env.GUILD_API_URL || "https://api.guild.ai/v1").replace(/\/$/, ""),
    },
    missing: [],
  };
}

export class GuildError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GuildError";
  }
}

type Fetch = typeof fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type GuildEvent = { id?: string; type?: string; created_at?: string; content?: unknown };

/** Picks the agent's final reply from a page of session events (any order). */
export function extractFinalOutput(events: GuildEvent[]): string | null {
  const ordered = [...events].sort((a, b) => String(a.created_at ?? a.id ?? "").localeCompare(String(b.created_at ?? b.id ?? "")));
  const textOf = (e: GuildEvent, field: "text" | "data"): string | null => {
    const c = e.content as Record<string, unknown> | null | undefined;
    if (!c || typeof c !== "object" || Array.isArray(c)) return null;
    if (c.is_delta) return null;
    const v = c[field];
    return typeof v === "string" && v.trim() ? v : null;
  };
  for (const e of [...ordered].reverse()) {
    if (e.type === "runtime_done") {
      const t = textOf(e, "text");
      if (t) return t;
    }
  }
  // Fallback: the agent's last non-streaming notification message.
  for (const e of [...ordered].reverse()) {
    if (e.type === "agent_notification_message") {
      const t = textOf(e, "data") ?? textOf(e, "text");
      if (t) return t;
    }
  }
  return null;
}

export function createGuildClient(config: GuildConfig, fetchImpl: Fetch = fetch): GuildClient {
  const auth = "Basic " + Buffer.from(config.apiKey).toString("base64");
  const workspacePath = UUID.test(config.workspace)
    ? config.workspace
    : config.workspace.includes("~")
      ? config.workspace
      : `${config.owner}~${config.workspace}`;

  async function call<T>(method: string, path: string, body?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(config.baseUrl + path, {
        method,
        headers: {
          authorization: auth,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(1, Math.min(REQUEST_TIMEOUT_MS, timeoutMs))),
      });
    } catch (err) {
      const why = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new GuildError(`Guild ${method} ${path} failed: ${why}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 300);
      try {
        const j = JSON.parse(text) as { error?: string; message?: string };
        detail = [j.error, j.message].filter(Boolean).join(": ") || detail;
      } catch {
        /* keep raw text */
      }
      throw new GuildError(`Guild ${method} ${path} → ${res.status}: ${detail}`, res.status);
    }
    try {
      return (text ? JSON.parse(text) : null) as T;
    } catch {
      throw new GuildError(`Guild ${method} ${path} returned non-JSON`);
    }
  }

  type RawSession = {
    id: string;
    session_url?: string | null;
    interrupted_at?: string | null;
    root_task?: { status?: string } | null;
  };

  const client: GuildClient = {
    async startSession(input, agentId = config.agentId) {
      const s = await call<RawSession>("POST", `/workspaces/${encodeURIComponent(workspacePath)}/sessions`, {
        session_type: "chat",
        agent_id: agentId,
        initial_prompt: typeof input === "string" ? input : JSON.stringify(input),
      });
      if (!s?.id) throw new GuildError("Guild session response had no id");
      return { id: s.id, sessionUrl: s.session_url ?? null, status: s.root_task?.status ?? null };
    },

    async waitForSession(id, { timeoutMs = 90_000, pollMs = 2_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new GuildError(`Guild session ${id} did not finish within ${timeoutMs}ms`);
        const s = await call<RawSession>("GET", `/sessions/${encodeURIComponent(id)}`, undefined, remaining);
        const status = s?.root_task?.status ?? (s?.interrupted_at ? "INTERRUPTED" : "UNKNOWN");
        if (status === "ERROR" || status === "INTERRUPTED") throw new GuildError(`Guild session ${id} ended with ${status}`);
        if (TERMINAL.has(status)) return { status };
        // A chat session can sit waiting for the next turn after it already replied.
        if (/WAIT/i.test(status) && (await client.getFinalOutput(id))) return { status };
        await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
      }
    },

    async getFinalOutput(id) {
      // Events come newest-first. Serializing older events (the run's start/LLM events) is slow —
      // limit=20 measured ~57s — so read only the newest few, where the final reply sits, and
      // fall back to a type-filtered read.
      const base = `/sessions/${encodeURIComponent(id)}/events?sort_by=-id`;
      const newest = await call<{ items?: GuildEvent[] }>("GET", `${base}&limit=5`);
      const text = extractFinalOutput(newest?.items ?? []);
      if (text) return text;
      const done = await call<{ items?: GuildEvent[] }>("GET", `${base}&types=runtime_done&limit=10`);
      return extractFinalOutput(done?.items ?? []);
    },
  };
  return client;
}

function envClient(): GuildClient {
  const { config, missing } = guildConfigFromEnv();
  if (!config) throw new GuildError(`Guild is not configured: missing ${missing.join(", ")}`);
  return createGuildClient(config);
}

export const startSession: GuildClient["startSession"] = (input, agentId) => envClient().startSession(input, agentId);
export const waitForSession: GuildClient["waitForSession"] = (id, opts) => envClient().waitForSession(id, opts);
export const getFinalOutput: GuildClient["getFinalOutput"] = (id) => envClient().getFinalOutput(id);
