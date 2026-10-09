import type { FixtureApp } from "./types";

const xssVulnerable = `// Intentionally vulnerable demo app — do not deploy
const express = require("express");
const app = express();

app.get("/greet", (req, res) => {
  const name = req.query.name || "guest";
  // CWE-79: reflected XSS — unsanitized user input in HTML response
  res.send("<h1>Welcome " + name + "</h1>");
});

app.get("/health", (_req, res) => res.json({ ok: true }));

module.exports = app;
`;

const xssPatched = `// CloseLoop verified patch — CWE-79
const express = require("express");
const app = express();

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

app.get("/greet", (req, res) => {
  const name = escapeHtml(req.query.name || "guest");
  res.type("html").send("<h1>Welcome " + name + "</h1>");
});

app.get("/health", (_req, res) => res.json({ ok: true }));

module.exports = app;
`;

const pathVulnerable = `// Intentionally vulnerable demo app — do not deploy
const fs = require("fs");
const path = require("path");
const express = require("express");
const app = express();

const ROOT = path.join(__dirname, "files");

app.get("/read", (req, res) => {
  const file = req.query.file || "readme.txt";
  // CWE-22: path traversal — user controls filesystem path
  const target = path.join(ROOT, file);
  try {
    const data = fs.readFileSync(target, "utf8");
    res.type("text").send(data);
  } catch {
    res.status(404).send("not found");
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

module.exports = { app, ROOT };
`;

const pathPatched = `// CloseLoop verified patch — CWE-22
const fs = require("fs");
const path = require("path");
const express = require("express");
const app = express();

const ROOT = path.join(__dirname, "files");

app.get("/read", (req, res) => {
  const file = String(req.query.file || "readme.txt");
  if (file.includes("..") || path.isAbsolute(file) || file.includes("\\0")) {
    return res.status(400).send("invalid path");
  }
  const target = path.resolve(ROOT, path.basename(file));
  if (!target.startsWith(path.resolve(ROOT) + path.sep) && target !== path.resolve(ROOT)) {
    return res.status(400).send("invalid path");
  }
  try {
    const data = fs.readFileSync(target, "utf8");
    res.type("text").send(data);
  } catch {
    res.status(404).send("not found");
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

module.exports = { app, ROOT };
`;

const sqliVulnerable = `// Intentionally vulnerable demo app — do not deploy
const express = require("express");
const app = express();

const USERS = [
  { id: 1, username: "alice", role: "user" },
  { id: 2, username: "admin", role: "admin" },
];

function fakeQuery(sql) {
  // Toy SQL interpreter for demo / PoC only
  const match = sql.match(/username\\s*=\\s*'([^']*)'/i);
  if (!match) return [];
  if (match[1].includes("' OR ") || match[1].includes("' or ")) {
    return USERS.slice();
  }
  return USERS.filter((u) => u.username === match[1]);
}

app.get("/users", (req, res) => {
  const username = req.query.username || "";
  // CWE-89: SQL injection — string concatenation into query
  const sql = "SELECT * FROM users WHERE username = '" + username + "'";
  const rows = fakeQuery(sql);
  res.json({ sql, rows });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

module.exports = app;
`;

const sqliPatched = `// CloseLoop verified patch — CWE-89
const express = require("express");
const app = express();

const USERS = [
  { id: 1, username: "alice", role: "user" },
  { id: 2, username: "admin", role: "admin" },
];

function lookupUser(username) {
  // Parameterized-style lookup — no concatenated SQL
  return USERS.filter((u) => u.username === String(username));
}

app.get("/users", (req, res) => {
  const username = String(req.query.username || "");
  const rows = lookupUser(username);
  res.json({ rows, parameterized: true });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

module.exports = app;
`;

const netpolVulnerable = `# Intentionally vulnerable NetworkPolicy — do not deploy
# From an authorized Kubernetes attack-sandbox lab.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-only-internal-broken
  namespace: protected
spec:
  podSelector: {}
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector: {}   # CWE-284: empty selector matches EVERY namespace,
                                  # not just "internal" as intended
`;

const netpolPatched = `# CloseLoop verified patch — CWE-284
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-only-internal
  namespace: protected
spec:
  podSelector: {}
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: internal
`;

const rbacVulnerable = `# Intentionally vulnerable RBAC grant — do not deploy
# From an authorized Kubernetes attack-sandbox lab.
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: excessive-secret-reader
  namespace: protected
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "list"]   # CWE-269: public-app-sa needs none of this
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: excessive-secret-reader-binding
  namespace: protected
subjects:
  - kind: ServiceAccount
    name: public-app-sa
    namespace: public
roleRef:
  kind: Role
  name: excessive-secret-reader
  apiGroup: rbac.authorization.k8s.io
`;

const rbacPatched = `# CloseLoop verified patch — CWE-269
#
# The Role and RoleBinding have been removed entirely: a public-facing
# app's ServiceAccount should hold no permissions on Secrets in a
# protected namespace. If a future workload genuinely needs this, grant
# it to that workload's own narrowly-scoped ServiceAccount, not the
# public ingress app's.
#
# (resources deleted — nothing to apply)
`;

export const FIXTURES: FixtureApp[] = [
  {
    id: "netpol-escape",
    name: "NetworkPolicy escape",
    description: "Empty namespaceSelector in a protected namespace's NetworkPolicy matches every namespace instead of just the intended one",
    language: "yaml",
    entryFile: "k8s/03-protected.yaml",
    vulnerableSource: netpolVulnerable,
    patchedSource: netpolPatched,
    finding: {
      id: "finding-netpol-001",
      title: "NetworkPolicy namespaceSelector: {} matches all namespaces, not just internal",
      severity: "high",
      cwe: "CWE-284",
      ruleId: "kubernetes.networking.security.empty-namespace-selector",
      file: "k8s/03-protected.yaml",
      startLine: 10,
      endLine: 10,
      message:
        "namespaceSelector: {} is an empty label selector, which Kubernetes treats as matching every namespace in the cluster — not the single namespace the author intended (CWE-284).",
      fixtureId: "netpol-escape",
    },
  },
  {
    id: "rbac-escape",
    name: "RBAC excessive permissions",
    description: "A public-facing app's ServiceAccount is granted get/list on Secrets in a protected namespace it has no legitimate need to read",
    language: "yaml",
    entryFile: "k8s/04-rbac-escape.yaml",
    vulnerableSource: rbacVulnerable,
    patchedSource: rbacPatched,
    finding: {
      id: "finding-rbac-001",
      title: "public-app-sa bound to a Role granting secrets access in protected, bypassing NetworkPolicy entirely",
      severity: "critical",
      cwe: "CWE-269",
      ruleId: "kubernetes.rbac.security.excessive-serviceaccount-permissions",
      file: "k8s/04-rbac-escape.yaml",
      startLine: 1,
      endLine: 23,
      message:
        "public-app-sa's auto-mounted token can get/list Secrets in protected via the Kubernetes API directly — independent of any network path, so NetworkPolicy fixes alone would not close this (CWE-269).",
      fixtureId: "rbac-escape",
    },
  },
  {
    id: "xss-greeter",
    name: "Greeter API",
    description: "Reflected XSS in /greet query parameter",
    language: "javascript",
    entryFile: "apps/greeter/server.js",
    vulnerableSource: xssVulnerable,
    patchedSource: xssPatched,
    finding: {
      id: "finding-xss-001",
      title: "Reflected cross-site scripting via name parameter",
      severity: "high",
      cwe: "CWE-79",
      ruleId: "javascript.express.security.audit.xss-res-send",
      file: "apps/greeter/server.js",
      startLine: 8,
      endLine: 9,
      message:
        "User-controlled input flows into res.send without HTML escaping (CWE-79).",
      fixtureId: "xss-greeter",
    },
  },
  {
    id: "path-reader",
    name: "File Reader",
    description: "Path traversal in /read file parameter",
    language: "javascript",
    entryFile: "apps/reader/server.js",
    vulnerableSource: pathVulnerable,
    patchedSource: pathPatched,
    finding: {
      id: "finding-path-001",
      title: "Path traversal via file query parameter",
      severity: "critical",
      cwe: "CWE-22",
      ruleId: "javascript.lang.security.audit.path-traversal",
      file: "apps/reader/server.js",
      startLine: 12,
      endLine: 14,
      message:
        "Untrusted file path concatenated into filesystem read (CWE-22).",
      fixtureId: "path-reader",
    },
  },
  {
    id: "sqli-users",
    name: "Users Lookup",
    description: "SQL injection in username filter",
    language: "javascript",
    entryFile: "apps/users/server.js",
    vulnerableSource: sqliVulnerable,
    patchedSource: sqliPatched,
    finding: {
      id: "finding-sqli-001",
      title: "SQL injection in username lookup",
      severity: "critical",
      cwe: "CWE-89",
      ruleId: "javascript.lang.security.audit.sqli-concatenation",
      file: "apps/users/server.js",
      startLine: 22,
      endLine: 24,
      message:
        "Query built with string concatenation from request input (CWE-89).",
      fixtureId: "sqli-users",
    },
  },
];

export function getFixture(id: string): FixtureApp | undefined {
  return FIXTURES.find((f) => f.id === id);
}

export function getFinding(id: string) {
  return FIXTURES.map((f) => f.finding).find((f) => f.id === id);
}

export function listFindings() {
  return FIXTURES.map((f) => f.finding);
}
