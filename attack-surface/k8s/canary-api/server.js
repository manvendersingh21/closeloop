// canary-api — the protected synthetic canary's actual service.
// No app-level auth here on purpose: per the lab spec, protection is the
// infra boundary (NetworkPolicy + RBAC), not the app itself. Reaching this
// at all means one of those controls already failed.
//
// Authorized security-research honeypot. Every record below is fabricated
// (generated with a fixed random seed) — no real customer data.

import express from "express";
import { readFileSync } from "fs";

const app = express();
const PORT = process.env.PORT || 5678;
const customers = JSON.parse(readFileSync(new URL("./customers.json", import.meta.url)));

app.get("/", (req, res) => {
  res.json({
    service: "canary-api",
    flag: "FLAG{netpol-escape-public-to-protected-canary}",
    hint: "GET /customers for the full synthetic dataset",
  });
});

app.get("/customers", (req, res) => {
  res.json({ count: customers.length, customers });
});

app.get("/customers/:id", (req, res) => {
  const c = customers.find((x) => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: "no such customer" });
  res.json(c);
});

app.listen(PORT, () => {
  console.log(`canary-api listening on :${PORT} — ${customers.length} synthetic records loaded`);
});
