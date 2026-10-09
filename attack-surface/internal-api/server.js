// internal-api — the "crown jewel". INTERNAL-ONLY: the Akash SDL exposes
// this port only to the "storefront" service, never to the public internet.
// Reaching it at all already requires pivoting through storefront's SSRF.
//
// Two deliberate bugs:
//
//   1. /internal/admin  (CWE-269, excessive permissions / improper auth) —
//      "protected" by a bearer credential, but that credential is exactly
//      the one metadata hands out to anyone who can reach IT. Possessing
//      the token is treated as sufficient; nothing else is checked. This
//      is the payoff of the SSRF -> metadata -> admin chain, and matches
//      the contract's example finding almost exactly (excessive permissions
//      allow access to protected data).
//
//   2. /internal/users/:id  (CWE-639, IDOR) — no authentication at all,
//      returns ANY user's fake record by guessing/incrementing an id.
//      A separate, easier bonus bug reachable the same way (via SSRF).
//
// Authorized security-research honeypot. All data below is fabricated.

import express from "express";

const app = express();
const PORT = process.env.PORT || 4000;
const IAM_TOKEN = process.env.IAM_TOKEN || "unset-dev-token";

const FAKE_CUSTOMERS = [
  { id: 1, name: "Jordan Alvarez", email: "jordan.alvarez@example.test", plan: "enterprise" },
  { id: 2, name: "Priya Natarajan", email: "priya.n@example.test", plan: "pro" },
  { id: 3, name: "Sam Okafor", email: "sam.okafor@example.test", plan: "free" },
];

function extractToken(req) {
  const auth = req.headers["authorization"];
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7);
  if (req.query.token) return String(req.query.token);
  return null;
}

// Bug 1: the main chain payoff.
app.get("/internal/admin", (req, res) => {
  const token = extractToken(req);
  if (token !== IAM_TOKEN) {
    return res.status(403).json({ error: "forbidden: missing or invalid credential" });
  }
  res.json({
    flag: "FLAG{ssrf-to-metadata-to-admin-" + IAM_TOKEN.slice(0, 6) + "}",
    message: "Credential accepted with no further checks — that's the bug.",
    customers: FAKE_CUSTOMERS,
  });
});

// Bug 2: bonus IDOR, no auth required at all.
app.get("/internal/users/:id", (req, res) => {
  const id = Number(req.params.id);
  const user = FAKE_CUSTOMERS.find((u) => u.id === id);
  if (!user) return res.status(404).json({ error: "no such user" });
  res.json(user);
});

app.listen(PORT, () => {
  console.log(`internal-api listening on :${PORT} — internal only`);
});
