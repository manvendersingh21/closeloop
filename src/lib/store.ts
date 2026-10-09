import { promises as fs } from "fs";
import path from "path";
import type { RemediationJob } from "./types";

const DATA_DIR = path.join(process.cwd(), ".closeloop-data");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");

async function ensure() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(JOBS_FILE);
  } catch {
    await fs.writeFile(JOBS_FILE, "[]", "utf8");
  }
}

export async function listJobs(): Promise<RemediationJob[]> {
  await ensure();
  const raw = await fs.readFile(JOBS_FILE, "utf8");
  return JSON.parse(raw) as RemediationJob[];
}

export async function getJob(id: string): Promise<RemediationJob | undefined> {
  const jobs = await listJobs();
  return jobs.find((j) => j.id === id);
}

export async function saveJob(job: RemediationJob): Promise<void> {
  await ensure();
  const jobs = await listJobs();
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  else jobs.unshift(job);
  await fs.writeFile(JOBS_FILE, JSON.stringify(jobs, null, 2), "utf8");
}

export async function clearJobs(): Promise<void> {
  await ensure();
  await fs.writeFile(JOBS_FILE, "[]", "utf8");
}
