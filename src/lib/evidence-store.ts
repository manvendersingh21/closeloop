// EvidenceStore backed by ClickHouse's HTTP interface (global fetch only).
// - Inserts: `INSERT INTO closeloop.<table> (...) FORMAT JSONEachRow` with the
//   statement urlencoded in the `query` param and newline-delimited JSON rows
//   as the POST body.
// - Reads: statement as POST body, user values passed as ClickHouse HTTP
//   query params (`{name:String}` in SQL + `param_name=...` in the URL).
//   Values are never string-concatenated into SQL.
// - Timestamps travel as 'YYYY-MM-DD HH:MM:SS.mmm' UTC; reads use
//   toUnixTimestamp64Milli so parsing is timezone-independent. Returned
//   timestamps are ISO 8601 strings ending in 'Z'.
import type {
  CheckResult,
  EvidenceStore,
  JobEvent,
  JobRecord,
} from "@/contracts/internal";
import { ExploitHandoffV1 as ExploitHandoffV1Schema, type ExploitHandoffV1 } from "@/contracts/handoff";

type Row = Record<string, unknown>;

function config() {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) throw new Error("CLICKHOUSE_URL is not set");
  const user = process.env.CLICKHOUSE_USER ?? "default";
  const password = process.env.CLICKHOUSE_PASSWORD ?? "";
  const database = process.env.CLICKHOUSE_DATABASE ?? "closeloop";
  return {
    url,
    database,
    headers: {
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
    },
  };
}

/** Monotonic millisecond clock: guarantees distinct timestamps for rows the
 * process writes in quick succession (ts ordering, ReplacingMergeTree version). */
let lastMs = 0;
function nextMs(): number {
  let now = Date.now();
  if (now <= lastMs) now = lastMs + 1;
  lastMs = now;
  return now;
}

function chTimestamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.` +
    p(d.getUTCMilliseconds(), 3)
  );
}

function isoToChTimestamp(iso: string): string {
  return chTimestamp(Date.parse(iso));
}

function msToIso(ms: number | string): string {
  return new Date(Number(ms)).toISOString();
}

async function post(url: URL, headers: Record<string, string>, body: string): Promise<string> {
  const res = await fetch(url, { method: "POST", headers, body });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ClickHouse ${res.status} for ${url.pathname}: ${text}`);
  }
  return text;
}

async function insertRows(table: string, columns: string[], rows: Row[]): Promise<void> {
  const { url, database, headers } = config();
  const target = new URL(url);
  target.searchParams.set("database", database);
  target.searchParams.set(
    "query",
    `INSERT INTO closeloop.${table} (${columns.join(", ")}) FORMAT JSONEachRow`,
  );
  const body = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await post(target, headers, body);
}

async function selectRows<T = Row>(
  sql: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const { url, database, headers } = config();
  const target = new URL(url);
  target.searchParams.set("database", database);
  for (const [name, value] of Object.entries(params)) {
    target.searchParams.set(`param_${name}`, value);
  }
  const text = await post(target, headers, sql);
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split("\n").map((line) => JSON.parse(line) as T);
}

function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

const JOB_COLUMNS = `job_id, finding_id, status, stage, attempt, policy_before, policy_after, summary, rationale, exploit_before, exploit_after, pr_url, error,
  toUnixTimestamp64Milli(started_at) AS started_at_ms,
  toUnixTimestamp64Milli(finished_at) AS finished_at_ms`;

function toJob(r: Row): JobRecord {
  return {
    job_id: String(r.job_id),
    finding_id: String(r.finding_id),
    status: r.status as JobRecord["status"],
    stage: r.stage as JobRecord["stage"],
    attempt: Number(r.attempt),
    policy_before: r.policy_before ? (JSON.parse(String(r.policy_before)) as JobRecord["policy_before"]) : null,
    policy_after: r.policy_after ? (JSON.parse(String(r.policy_after)) as JobRecord["policy_after"]) : null,
    summary: JSON.parse(String(r.summary ?? "[]")) as string[],
    rationale: String(r.rationale ?? ""),
    exploit_before: r.exploit_before as JobRecord["exploit_before"],
    exploit_after: r.exploit_after as JobRecord["exploit_after"],
    pr_url: r.pr_url ? String(r.pr_url) : null,
    error: r.error ? String(r.error) : null,
    started_at: msToIso(r.started_at_ms as number),
    finished_at: r.finished_at_ms == null ? null : msToIso(r.finished_at_ms as number),
  };
}

function toCheck(r: Row): CheckResult {
  const check: CheckResult = {
    check_id: String(r.check_id),
    phase: r.phase as CheckResult["phase"],
    attempt: Number(r.attempt),
    expected: r.expected as CheckResult["expected"],
    actual: r.actual as CheckResult["actual"],
    passed: toBool(r.passed),
  };
  const detail = r.detail ? String(r.detail) : "";
  if (detail) check.detail = detail;
  return check;
}

export const evidenceStore: EvidenceStore = {
  async saveHandoff(handoff: ExploitHandoffV1): Promise<void> {
    await insertRows(
      "handoffs",
      [
        "finding_id",
        "received_at",
        "schema_version",
        "title",
        "severity",
        "category",
        "cwe",
        "target_id",
        "environment",
        "authorization",
        "confidence",
        "payload",
      ],
      [
        {
          finding_id: handoff.finding_id,
          received_at: chTimestamp(nextMs()),
          schema_version: handoff.schema_version,
          title: handoff.title,
          severity: handoff.severity,
          category: handoff.vulnerability.category,
          cwe: handoff.vulnerability.cwe,
          target_id: handoff.scope.target_id,
          environment: handoff.scope.environment,
          authorization: handoff.scope.authorization,
          confidence: handoff.evidence.confidence,
          payload: JSON.stringify(handoff),
        },
      ],
    );
  },

  async getHandoff(findingId: string): Promise<ExploitHandoffV1 | null> {
    const rows = await selectRows(
      `SELECT payload FROM closeloop.handoffs
       WHERE finding_id = {finding_id:String}
       ORDER BY received_at DESC
       LIMIT 1
       FORMAT JSONEachRow`,
      { finding_id: findingId },
    );
    if (rows.length === 0) return null;
    return ExploitHandoffV1Schema.parse(JSON.parse(String(rows[0].payload)));
  },

  async upsertJob(job: JobRecord): Promise<void> {
    await insertRows(
      "jobs",
      [
        "job_id",
        "finding_id",
        "status",
        "stage",
        "attempt",
        "policy_before",
        "policy_after",
        "summary",
        "rationale",
        "exploit_before",
        "exploit_after",
        "pr_url",
        "error",
        "started_at",
        "finished_at",
        "updated_at",
      ],
      [
        {
          job_id: job.job_id,
          finding_id: job.finding_id,
          status: job.status,
          stage: job.stage,
          attempt: job.attempt,
          policy_before: job.policy_before ? JSON.stringify(job.policy_before) : "",
          policy_after: job.policy_after ? JSON.stringify(job.policy_after) : "",
          summary: JSON.stringify(job.summary ?? []),
          rationale: job.rationale ?? "",
          exploit_before: job.exploit_before,
          exploit_after: job.exploit_after,
          pr_url: job.pr_url ?? "",
          error: job.error ?? "",
          started_at: isoToChTimestamp(job.started_at),
          finished_at: job.finished_at ? isoToChTimestamp(job.finished_at) : null,
          // explicit ms-precision version so two quick upserts order correctly
          updated_at: chTimestamp(nextMs()),
        },
      ],
    );
  },

  async getJob(jobId: string): Promise<JobRecord | null> {
    const rows = await selectRows(
      `SELECT ${JOB_COLUMNS}
       FROM closeloop.jobs FINAL
       WHERE job_id = {job_id:String}
       FORMAT JSONEachRow`,
      { job_id: jobId },
    );
    return rows.length ? toJob(rows[0]) : null;
  },

  async findLatestJobForFinding(findingId: string): Promise<JobRecord | null> {
    const rows = await selectRows(
      `SELECT ${JOB_COLUMNS}
       FROM closeloop.jobs FINAL
       WHERE finding_id = {finding_id:String}
       ORDER BY started_at DESC
       LIMIT 1
       FORMAT JSONEachRow`,
      { finding_id: findingId },
    );
    return rows.length ? toJob(rows[0]) : null;
  },

  async listJobs(limit = 20): Promise<JobRecord[]> {
    const rows = await selectRows(
      `SELECT ${JOB_COLUMNS}
       FROM closeloop.jobs FINAL
       ORDER BY started_at DESC
       LIMIT {limit:UInt32}
       FORMAT JSONEachRow`,
      { limit: String(limit) },
    );
    return rows.map(toJob);
  },

  async recordCheck(jobId: string, findingId: string, check: CheckResult): Promise<void> {
    await insertRows(
      "verification_checks",
      [
        "job_id",
        "finding_id",
        "ts",
        "check_id",
        "attempt",
        "phase",
        "expected",
        "actual",
        "passed",
        "detail",
      ],
      [
        {
          job_id: jobId,
          finding_id: findingId,
          ts: chTimestamp(nextMs()),
          check_id: check.check_id,
          attempt: check.attempt,
          phase: check.phase,
          expected: check.expected,
          actual: check.actual,
          passed: check.passed ? 1 : 0,
          detail: check.detail ?? "",
        },
      ],
    );
  },

  async getChecks(jobId: string): Promise<CheckResult[]> {
    const rows = await selectRows(
      `SELECT check_id, phase, attempt, expected, actual, passed, detail
       FROM closeloop.verification_checks
       WHERE job_id = {job_id:String}
       ORDER BY ts
       FORMAT JSONEachRow`,
      { job_id: jobId },
    );
    return rows.map(toCheck);
  },

  async recordEvent(
    jobId: string,
    stage: string,
    message: string,
    level: JobEvent["level"] = "info",
  ): Promise<void> {
    await insertRows(
      "events",
      ["job_id", "ts", "stage", "level", "message"],
      [
        {
          job_id: jobId,
          ts: chTimestamp(nextMs()),
          stage,
          level,
          message,
        },
      ],
    );
  },

  async getEvents(jobId: string): Promise<JobEvent[]> {
    const rows = await selectRows(
      `SELECT toUnixTimestamp64Milli(ts) AS ts_ms, stage, level, message
       FROM closeloop.events
       WHERE job_id = {job_id:String}
       ORDER BY ts
       FORMAT JSONEachRow`,
      { job_id: jobId },
    );
    return rows.map((r) => ({
      ts: msToIso(r.ts_ms as number),
      stage: String(r.stage),
      level: r.level as JobEvent["level"],
      message: String(r.message),
    }));
  },
};
