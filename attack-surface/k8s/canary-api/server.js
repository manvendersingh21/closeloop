// canary-api — the protected synthetic canary's actual service.
// No app-level auth here on purpose: per the lab spec, protection is the
// infra boundary (NetworkPolicy + RBAC), not the app. Reaching this at all
// means one of those controls already failed.
//
// THIRD LOOPHOLE (application-level, CWE-915 mass assignment + CWE-639
// IDOR): PATCH /customers/:id accepts and merges ANY field from the
// request body, with no ownership check and no field allowlist. Anyone
// who reaches this can edit any customer's record — including fields a
// real app would never let a client set directly, like `plan` or
// `risk_score`. A very common real-world bug class: an update endpoint
// that forgot to allowlist which fields the caller may actually change.
//
// Every request is logged with an escalation category — read / write /
// exfiltration — so an outside dashboard can watch what's actually
// happening, not just infer it.
//
// Authorized security-research honeypot. Every record below is fabricated
// (generated with a fixed random seed) — no real customer data.

import express from "express";
import { readFileSync } from "fs";

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 5678;

let customers = JSON.parse(readFileSync(new URL("./customers.json", import.meta.url)));

// --- escalation log ---
// In-memory, capped. Each entry: {id, ts, method, path, category, ip, detail}
const LOG = [];
let logSeq = 0;
function logEvent(req, category, detail) {
  const entry = {
    id: ++logSeq,
    ts: new Date().toISOString(),
    method: req.method,
    path: req.originalUrl,
    category, // "read" | "exfiltration" | "write" | "recon"
    ip: req.ip || req.socket?.remoteAddress || "unknown",
    detail: detail || null,
  };
  LOG.push(entry);
  if (LOG.length > 1000) LOG.shift();
  console.log(`[${entry.category}] ${entry.method} ${entry.path} from ${entry.ip}${detail ? " — " + JSON.stringify(detail) : ""}`);
}

app.get("/", (req, res) => {
  logEvent(req, "recon");
  res.json({
    service: "canary-api",
    flag: "FLAG{netpol-escape-public-to-protected-canary}",
    hint: "GET /customers for the full synthetic dataset",
  });
});

// Bulk read of every record at once — the exfiltration signal.
app.get("/customers", (req, res) => {
  logEvent(req, "exfiltration", { recordCount: customers.length });
  res.json({ count: customers.length, customers });
});

// Single-record read — ordinary "read", not flagged as bulk exfil.
app.get("/customers/:id", (req, res) => {
  const id = Number(req.params.id);
  const customer = customers.find((u) => u.id === id);
  if (!customer) {
    logEvent(req, "read", { id, found: false });
    return res.status(404).json({ error: "no such customer" });
  }
  logEvent(req, "read", { id });
  res.json(customer);
});

// THE LOOPHOLE: unauthenticated edit, no field allowlist (mass assignment).
app.patch("/customers/:id", (req, res) => {
  const id = Number(req.params.id);
  const idx = customers.findIndex((u) => u.id === id);
  if (idx === -1) {
    logEvent(req, "write", { id, found: false });
    return res.status(404).json({ error: "no such customer" });
  }
  const before = { ...customers[idx] };
  // No allowlist: whatever fields the caller sends get merged straight in,
  // `id` excepted. A real app would reject plan/risk_score/mrr_usd here.
  const { id: _ignored, ...patch } = req.body || {};
  customers[idx] = { ...customers[idx], ...patch };
  const after = { ...customers[idx] };
  logEvent(req, "write", { id, before, after, fieldsChanged: Object.keys(patch) });
  res.json({ updated: after });
});

app.get("/logs", (req, res) => {
  const since = Number(req.query.since) || 0;
  res.json({ logs: LOG.filter((l) => l.id > since), lastId: logSeq });
});

app.listen(PORT, () => {
  console.log(`canary-api listening on :${PORT} — ${customers.length} synthetic records loaded`);
});
