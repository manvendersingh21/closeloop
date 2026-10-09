// In-memory EvidenceStore for unit tests (no ClickHouse).
import type { ExploitHandoffV1 } from "@/contracts/handoff";
import type { CheckResult, EvidenceStore, JobEvent, JobRecord } from "@/contracts/internal";

export function createMemoryStore(): EvidenceStore {
  const handoffs = new Map<string, ExploitHandoffV1>();
  const jobs = new Map<string, JobRecord>();
  const checks = new Map<string, CheckResult[]>();
  const events = new Map<string, JobEvent[]>();
  const clone = <T>(v: T | undefined) => (v === undefined ? null : structuredClone(v));

  return {
    async saveHandoff(h) {
      handoffs.set(h.finding_id, structuredClone(h));
    },
    async getHandoff(findingId) {
      return clone(handoffs.get(findingId));
    },
    async upsertJob(job) {
      jobs.set(job.job_id, structuredClone(job));
    },
    async getJob(jobId) {
      return clone(jobs.get(jobId));
    },
    async findLatestJobForFinding(findingId) {
      const all = [...jobs.values()].filter((j) => j.finding_id === findingId);
      return clone(all.sort((a, b) => b.started_at.localeCompare(a.started_at))[0]);
    },
    async listJobs(limit = 20) {
      return [...jobs.values()].slice(-limit).reverse();
    },
    async recordCheck(jobId, _findingId, c) {
      checks.set(jobId, [...(checks.get(jobId) ?? []), c]);
    },
    async getChecks(jobId) {
      return checks.get(jobId) ?? [];
    },
    async recordEvent(jobId, stage, message, level = "info") {
      events.set(jobId, [...(events.get(jobId) ?? []), { ts: new Date().toISOString(), stage, level, message }]);
    },
    async getEvents(jobId) {
      return events.get(jobId) ?? [];
    },
  };
}
