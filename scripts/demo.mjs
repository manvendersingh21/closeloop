#!/usr/bin/env node
// Full CloseLoop demo: reset lab → POST handoff → poll until verified (+ PR URL).
// Never prints secret values.
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { spawn, execSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {}

const PORT = process.env.CLOSELOOP_DEMO_PORT || "3211";
const BASE = `http://127.0.0.1:${PORT}`;
const ingest = process.env.CLOSELOOP_INGEST_TOKEN;
const dseq = process.env.AKASH_LAB_DSEQ;
const labUrl = (process.env.LAB_BASE_URL || "").replace(/\/$/, "");

function die(msg) {
  console.error(`[demo] ${msg}`);
  process.exit(1);
}

if (!ingest) die("CLOSELOOP_INGEST_TOKEN missing");
if (!dseq) die("AKASH_LAB_DSEQ missing");
if (!labUrl) die("LAB_BASE_URL missing");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit", env: process.env, ...opts });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} → ${code}`))));
  });
}

async function waitHealth(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const j = await res.json();
        if (j.ready) return j;
        console.log("[demo] health ok but not ready yet; config flags:", JSON.stringify(j.config));
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  die("server health not ready");
}

console.log("[demo] 1/4 lab reset");
await run("node", ["scripts/lab-reset.mjs"]);

console.log("[demo] 2/4 restart server on", BASE);
// Always restart so this run picks up the latest build/env.
try {
  execSync(`fuser -k ${PORT}/tcp`, { stdio: "ignore" });
} catch {}
await new Promise((r) => setTimeout(r, 800));
const server = spawn("pnpm", ["exec", "next", "start", "-p", PORT], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});
await waitHealth();

console.log("[demo] 3/4 POST handoff");
const template = JSON.parse(
  readFileSync(path.join(root, "contracts/examples/FIND-002.akash.handoff.json"), "utf8"),
);
const findingId = `FIND-E2E-${Date.now()}`;
template.finding_id = findingId;
template.akash = {
  ...template.akash,
  dseq,
  service: process.env.AKASH_LAB_SERVICE || "lab-api",
  policy_env_var: "POLICY_JSON",
  base_url: labUrl,
};
template.handoff = {
  ...template.handoff,
  created_at: new Date().toISOString(),
};

const accept = await fetch(`${BASE}/api/handoffs`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${ingest}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(template),
});
const acceptBody = await accept.json();
if (accept.status !== 202) {
  die(`handoff → ${accept.status}: ${JSON.stringify(acceptBody).slice(0, 300)}`);
}
const jobId = acceptBody.job_id;
console.log(`[demo] accepted job_id=${jobId} finding_id=${findingId}`);

console.log("[demo] 4/4 poll result");
const deadline = Date.now() + 600_000;
let result = null;
while (Date.now() < deadline) {
  const res = await fetch(`${BASE}/api/jobs/${jobId}/result`, {
    headers: { authorization: `Bearer ${ingest}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 200) {
    result = await res.json();
    const status = result.status || result.report?.status;
    console.log(`[demo] status=${status} pr_url=${result.pr_url ?? result.report?.prUrl ?? "(none)"}`);
    if (["verified", "failed", "rolled_back", "rejected"].includes(status)) break;
  } else if (res.status === 404) {
    // still ingesting
  } else if (res.status !== 202) {
    console.log(`[demo] result HTTP ${res.status}`);
  }
  await new Promise((r) => setTimeout(r, 4000));
}

if (!result) die("timed out waiting for job result");

const outDir = path.join(root, ".closeloop-data");
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `demo-${jobId}.json`);
writeFileSync(outPath, JSON.stringify({ findingId, jobId, result }, null, 2));
console.log(`[demo] wrote ${outPath}`);

const status = result.status || result.report?.status;
const prUrl = result.pr_url ?? result.report?.prUrl ?? null;
console.log(`[demo] DONE status=${status}`);
console.log(`[demo] job_id=${jobId}`);
console.log(`[demo] finding_id=${findingId}`);
console.log(`[demo] pr_url=${prUrl ?? "(none)"}`);
console.log(`[demo] ui=${BASE}/jobs/${jobId}`);

try {
  server.kill("SIGTERM");
} catch {}

if (status !== "verified" || !prUrl) process.exit(2);
process.exit(0);
