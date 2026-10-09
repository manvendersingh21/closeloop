import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { ExploitHandoffV1, type IngestAccepted } from "@/contracts/handoff";
import type { EvidenceStore } from "@/contracts/internal";
import { labAccountId } from "./config";
import { defaultDeps, newJob, runJob } from "./orchestrator";
import { stableStringify } from "./policy";

export interface IngestOutcome {
  status: number;
  body: Record<string, unknown>;
  /** Present on 202: the caller schedules this after responding. */
  run?: () => Promise<unknown>;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest();

function tokenOk(header: string | null, expected: string): boolean {
  const got = header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  return timingSafeEqual(sha256(got), sha256(expected));
}

// Serialize hand-offs per finding_id so concurrent duplicates can't both create jobs.
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

const accepted = (jobId: string, findingId: string): IngestAccepted => ({
  job_id: jobId,
  finding_id: findingId,
  result_url: `/api/jobs/${jobId}/result`,
});

/** POST /api/handoffs per contracts/CONTRACT.md §2.1. */
export async function ingestHandoff(
  authHeader: string | null,
  rawBody: string,
  store: EvidenceStore,
): Promise<IngestOutcome> {
  const token = process.env.CLOSELOOP_INGEST_TOKEN;
  if (!token) return { status: 500, body: { error: "CLOSELOOP_INGEST_TOKEN is not configured" } };
  if (!tokenOk(authHeader, token)) return { status: 401, body: { error: "unauthorized" } };

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "invalid JSON", issues: [] } };
  }

  // environment / authorization literals are enforced by the schema itself.
  const parsed = ExploitHandoffV1.safeParse(json);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: "hand-off does not match exploit-handoff/v1",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
  }
  const h = parsed.data;

  if (h.akash) {
    // Akash lab: the hand-off must name exactly the deployment and host this server is configured for.
    const dseq = process.env.AKASH_LAB_DSEQ;
    const base = process.env.LAB_BASE_URL;
    if (!dseq || !base) return { status: 500, body: { error: "AKASH_LAB_DSEQ / LAB_BASE_URL are not configured" } };
    if (h.akash.dseq !== dseq || new URL(h.akash.base_url).host !== new URL(base).host) {
      return { status: 403, body: { error: "out of scope: Akash deployment or host is not the configured lab" } };
    }
  } else {
    const lab = labAccountId();
    if (!lab) return { status: 500, body: { error: "LAB_AWS_ACCOUNT_ID is not configured" } };
  if (h.scope.aws_account_id !== lab) {
    return { status: 403, body: { error: `out of scope: account ${h.scope.aws_account_id} is not the lab account` } };
  }
  const arnAccount = (arn: string) => arn.split(":")[4];
  if (
    arnAccount(h.target.principal_arn) !== lab ||
    !h.target.principal_arn.endsWith(`/${h.target.role_name}`) ||
    arnAccount(h.exploit.replay.assume_role_arn) !== lab
  ) {
    return { status: 403, body: { error: "out of scope: target role is not in the lab account or does not match role_name" } };
  }
  }

  const fingerprint = stableStringify(h);

  return withLock(h.finding_id, async (): Promise<IngestOutcome> => {
    const existing = await store.findLatestJobForFinding(h.finding_id);
    if (existing) {
      const prior = await store.getHandoff(h.finding_id);
      if (prior && stableStringify(prior) === fingerprint) {
        return { status: 200, body: accepted(existing.job_id, h.finding_id) };
      }
      if (existing.status === "in_progress") {
        return {
          status: 409,
          body: { error: `finding ${h.finding_id} has a running job with a different hand-off`, job_id: existing.job_id },
        };
      }
      // Different payload and the previous job finished: treat as a new attempt.
    }

    const job = newJob(randomUUID(), h.finding_id);
    await store.saveHandoff(h);
    await store.upsertJob(job);
    await store.recordEvent(job.job_id, "queued", `Accepted ${h.finding_id} for ${h.target.role_name}`);
    return { status: 202, body: accepted(job.job_id, h.finding_id), run: () => runJob(job, h, { ...defaultDeps, store }) };
  });
}
