// CloseLoop lab target — intentionally misconfigured for an authorized demo.
// Every request is checked against POLICY_JSON. The shipped policy grants
// data:read on "*", which exposes the protected canary. Do not reuse in production.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.WORKLOAD_TOKEN || "";

export const DATA = {
  "app/config.json": { feature_flags: { checkout: true }, region: "akash" },
  "app/catalog.json": { items: ["widget", "gadget"] },
  "canary/secret.txt": "CLOSELOOP-CANARY-7f3a9c: if you can read this, the policy is too broad",
};

export function parsePolicy(raw) {
  const policy = JSON.parse(raw);
  if (!Array.isArray(policy?.statements)) throw new Error("policy.statements must be an array");
  return policy;
}

const glob = (pattern, value) =>
  new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(value);

const matches = (patterns, value) => [].concat(patterns).some((p) => glob(p, value));

/** Explicit deny wins, then any allow, else implicit deny. */
export function evaluate(policy, action, resource) {
  const hits = policy.statements.filter((s) => matches(s.actions, action) && matches(s.resources, resource));
  if (hits.some((s) => s.effect === "deny")) return "deny";
  if (hits.some((s) => s.effect === "allow")) return "allow";
  return "deny";
}

function authorized(req) {
  const got = Buffer.from((req.headers.authorization || "").replace(/^Bearer /, ""));
  const want = Buffer.from(TOKEN);
  return TOKEN.length > 0 && got.length === want.length && timingSafeEqual(got, want);
}

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

export function createApp(policyRaw) {
  const policy = parsePolicy(policyRaw);
  const orders = [];

  return createServer((req, res) => {
    const url = new URL(req.url, "http://lab");

    if (url.pathname === "/healthz") return send(res, 200, { ok: true });
    if (!authorized(req)) return send(res, 401, { error: "unauthorized" });

    if (req.method === "GET" && url.pathname === "/whoami") {
      return send(res, 200, { principal: "lab-workload-01", policy });
    }

    if (req.method === "GET" && url.pathname.startsWith("/data/")) {
      const resource = url.pathname.slice("/data/".length);
      if (evaluate(policy, "data:read", resource) !== "allow") {
        return send(res, 403, { error: "forbidden", action: "data:read", resource });
      }
      if (!(resource in DATA)) return send(res, 404, { error: "not found", resource });
      return send(res, 200, { resource, content: DATA[resource] });
    }

    if (req.method === "POST" && url.pathname === "/orders") {
      if (evaluate(policy, "orders:write", "orders") !== "allow") {
        return send(res, 403, { error: "forbidden", action: "orders:write", resource: "orders" });
      }
      const order = { id: orders.length + 1, at: new Date().toISOString() };
      orders.push(order);
      return send(res, 201, order);
    }

    return send(res, 404, { error: "not found" });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!TOKEN) {
    console.error("WORKLOAD_TOKEN is required");
    process.exit(1);
  }
  const app = createApp(process.env.POLICY_JSON || '{"statements":[]}');
  app.listen(PORT, () => console.log(`lab-api listening on :${PORT}`));
}
