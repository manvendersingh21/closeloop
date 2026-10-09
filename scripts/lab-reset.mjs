#!/usr/bin/env node
// Reset the Akash lab-api POLICY_JSON to the vulnerable SDL baseline, then wait
// until canary reads succeed again (200). Never prints secret values.
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {}

const API = process.env.AKASH_CONSOLE_API_URL || "https://console-api.akash.network";
const dseq = process.env.AKASH_LAB_DSEQ;
const service = process.env.AKASH_LAB_SERVICE || "lab-api";
const baseUrl = (process.env.LAB_BASE_URL || "").replace(/\/$/, "");
const token = process.env.LAB_WORKLOAD_TOKEN;
const key = process.env.AKASH_CONSOLE_API_KEY;

function die(msg) {
  console.error(`[lab-reset] ${msg}`);
  process.exit(1);
}

if (!dseq) die("AKASH_LAB_DSEQ missing");
if (!baseUrl) die("LAB_BASE_URL missing");
if (!token) die("LAB_WORKLOAD_TOKEN missing");
if (!key) die("AKASH_CONSOLE_API_KEY missing");

const sdl = readFileSync(path.join(root, "lab/akash/lab-api.sdl.yaml"), "utf8");
const m = sdl.match(/POLICY_JSON=(\{.*\})'/m);
if (!m) die("could not parse POLICY_JSON from lab/akash/lab-api.sdl.yaml");
const policyJson = m[1];

console.log(`[lab-reset] PATCH dseq=${dseq} service=${service} → vulnerable baseline`);

const patchRes = await fetch(`${API}/v1/deployments/${encodeURIComponent(dseq)}`, {
  method: "PATCH",
  headers: {
    "x-api-key": key,
    "content-type": "application/json",
    "user-agent": "closeloop-lab-reset",
  },
  body: JSON.stringify({ data: { services: { [service]: { env: { POLICY_JSON: policyJson } } } } }),
  signal: AbortSignal.timeout(60_000),
});
const patchText = await patchRes.text();
if (!patchRes.ok) {
  die(`Akash PATCH → ${patchRes.status}: ${patchText.slice(0, 200)}`);
}
console.log(`[lab-reset] PATCH ok (${patchRes.status}); waiting for canary 200…`);

const deadline = Date.now() + 240_000;
let last = "n/a";
while (Date.now() < deadline) {
  try {
    const res = await fetch(`${baseUrl}/data/canary/secret.txt`, {
      headers: { authorization: `Bearer ${token}`, "user-agent": "closeloop-lab-reset" },
      signal: AbortSignal.timeout(10_000),
    });
    last = String(res.status);
    if (res.status === 200) {
      console.log("[lab-reset] canary readable again (200) — lab is vulnerable baseline");
      process.exit(0);
    }
  } catch (err) {
    last = err instanceof Error ? err.message : String(err);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
die(`timed out waiting for canary 200 (last=${last})`);
