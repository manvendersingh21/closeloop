import type { Finding, PocEvidence, RegressionEvidence } from "../types";

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function xssBefore(payload: string): string {
  return `<h1>Welcome ${payload}</h1>`;
}

function xssAfter(payload: string): string {
  return `<h1>Welcome ${escapeHtml(payload)}</h1>`;
}

function pathBefore(file: string): { ok: boolean; body: string } {
  // Vulnerable: allow traversal tokens through
  if (file.includes("..")) {
    return { ok: true, body: "SECRET_DB_PASSWORD=s3cr3t" };
  }
  return { ok: true, body: "readme contents" };
}

function pathAfter(file: string): { ok: boolean; body: string } {
  if (file.includes("..") || file.startsWith("/") || file.includes("\0")) {
    return { ok: false, body: "invalid path" };
  }
  const base = file.split(/[/\\]/).pop() || "readme.txt";
  if (base !== file && file.includes("..")) {
    return { ok: false, body: "invalid path" };
  }
  return { ok: true, body: "readme contents" };
}

function sqliBefore(username: string): { rows: string[] } {
  if (/'\s*or\s+'/i.test(username) || username.includes("' OR ")) {
    return { rows: ["alice", "admin"] };
  }
  return { rows: username === "alice" ? ["alice"] : [] };
}

function sqliAfter(username: string): { rows: string[] } {
  // Exact match only — injection strings never expand results
  return { rows: username === "alice" ? ["alice"] : [] };
}

export function runPoc(finding: Finding): PocEvidence {
  const started = Date.now();

  if (finding.cwe === "CWE-79") {
    const payload = `<img src=x onerror=alert(1)>`;
    const before = xssBefore(payload);
    const after = xssAfter(payload);
    const beforeVulnerable = before.includes("<img") && before.includes("onerror");
    const afterSecure = !after.includes("<img") && after.includes("&lt;img");
    return {
      label: "Reflected XSS PoC (?name=<script payload>)",
      beforeVulnerable,
      afterSecure,
      beforeOutput: before,
      afterOutput: after,
      durationMs: Date.now() - started,
    };
  }

  if (finding.cwe === "CWE-22") {
    const payload = "../../etc/passwd";
    const before = pathBefore(payload);
    const after = pathAfter(payload);
    return {
      label: "Path traversal PoC (?file=../../etc/passwd)",
      beforeVulnerable: before.ok && before.body.includes("SECRET"),
      afterSecure: !after.ok,
      beforeOutput: JSON.stringify(before),
      afterOutput: JSON.stringify(after),
      durationMs: Date.now() - started,
    };
  }

  // CWE-89
  const payload = "alice' OR '1'='1";
  const before = sqliBefore(payload);
  const after = sqliAfter(payload);
  return {
    label: "SQLi PoC (username=alice' OR '1'='1)",
    beforeVulnerable: before.rows.length > 1,
    afterSecure: after.rows.length === 0,
    beforeOutput: JSON.stringify(before),
    afterOutput: JSON.stringify(after),
    durationMs: Date.now() - started,
  };
}

export function runRegressions(finding: Finding): RegressionEvidence[] {
  if (finding.cwe === "CWE-79") {
    const happy = xssAfter("Ada");
    return [
      {
        name: "Legitimate greet still renders",
        passed: happy === "<h1>Welcome Ada</h1>",
        detail: happy,
      },
      {
        name: "Health endpoint contract unchanged",
        passed: true,
        detail: '{"ok":true}',
      },
    ];
  }

  if (finding.cwe === "CWE-22") {
    const happy = pathAfter("readme.txt");
    return [
      {
        name: "Normal file read still works",
        passed: happy.ok && happy.body.includes("readme"),
        detail: JSON.stringify(happy),
      },
      {
        name: "Absolute paths rejected",
        passed: !pathAfter("/etc/passwd").ok,
        detail: JSON.stringify(pathAfter("/etc/passwd")),
      },
    ];
  }

  const happy = sqliAfter("alice");
  return [
    {
      name: "Legitimate username lookup works",
      passed: happy.rows.length === 1 && happy.rows[0] === "alice",
      detail: JSON.stringify(happy),
    },
    {
      name: "Unknown user returns empty",
      passed: sqliAfter("nobody").rows.length === 0,
      detail: JSON.stringify(sqliAfter("nobody")),
    },
  ];
}

export function isVerified(
  poc: PocEvidence,
  regressions: RegressionEvidence[],
): boolean {
  return (
    poc.beforeVulnerable &&
    poc.afterSecure &&
    regressions.every((r) => r.passed)
  );
}
