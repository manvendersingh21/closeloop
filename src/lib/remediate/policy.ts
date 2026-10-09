import type { PolicyDocument, PolicyStatement } from "@/contracts/internal";

const toArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Deterministic JSON (sorted keys at every level) for hashing and deep-equality. */
export function stableStringify(v: unknown): string {
  if (v === undefined) return "";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

/**
 * Coerce a raw IAM policy (from GetRolePolicy or the model) into the contract's
 * PolicyDocument. Throws on anything we don't remediate: other Versions,
 * NotAction/NotResource/Principal, or a statement missing Effect/Action/Resource.
 */
export function normalizePolicy(raw: unknown): PolicyDocument {
  if (!raw || typeof raw !== "object") throw new Error("policy is not an object");
  const doc = raw as Record<string, unknown>;
  if (doc.Version !== "2012-10-17") throw new Error(`unsupported policy Version ${String(doc.Version)}`);
  const stmts = toArray(doc.Statement as Record<string, unknown> | Record<string, unknown>[]);
  const Statement = stmts.map((s, i): PolicyStatement => {
    for (const k of ["NotAction", "NotResource", "Principal", "NotPrincipal"]) {
      if (k in s) throw new Error(`statement ${i} uses unsupported ${k}`);
    }
    if (s.Effect !== "Allow" && s.Effect !== "Deny") throw new Error(`statement ${i} has invalid Effect`);
    if (s.Action === undefined || s.Resource === undefined) throw new Error(`statement ${i} needs Action and Resource`);
    return s as unknown as PolicyStatement;
  });
  return { Version: "2012-10-17", Statement };
}

/** IAM wildcard match: `*` any run, `?` one char. Actions are case-insensitive. */
export function globMatch(pattern: string, value: string, ignoreCase = false): boolean {
  const re = pattern
    .split("")
    .map((c) => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${re}$`, ignoreCase ? "i" : "").test(value);
}

const grants = (s: PolicyStatement, action: string, resource: string) =>
  toArray(s.Action).some((a) => globMatch(a, action, true)) && toArray(s.Resource).some((r) => globMatch(r, resource));

/** Condition-free evaluator for mock mode. Explicit deny wins, default deny. */
export function evaluateLocally(p: PolicyDocument, action: string, resource: string): "allow" | "deny" {
  const hits = p.Statement.filter((s) => grants(s, action, resource));
  return hits.some((s) => s.Effect === "Allow") && !hits.some((s) => s.Effect === "Deny") ? "allow" : "deny";
}

/**
 * Safety rules for a proposed policy, independent of the checks:
 * 1. Every statement other than the offending one is kept byte-for-byte (by Sid).
 * 2. Nothing is widened: each (action, resource) an Allow grants must already be
 *    granted by a single original Allow with the same Condition.
 * Returns violations; empty means OK.
 */
export function patchViolations(before: PolicyDocument, after: PolicyDocument, offendingSid: string): string[] {
  const out: string[] = [];
  const afterBySid = new Map(after.Statement.filter((s) => s.Sid).map((s) => [s.Sid, s]));
  for (const s of before.Statement) {
    if (s.Sid === offendingSid) continue;
    const kept = s.Sid ? afterBySid.get(s.Sid) : after.Statement.find((x) => stableStringify(x) === stableStringify(s));
    if (!kept || stableStringify(kept) !== stableStringify(s)) {
      out.push(`statement ${s.Sid ?? "(unnamed)"} is unrelated to the finding and must stay unchanged`);
    }
  }

  const beforeAllows = before.Statement.filter((s) => s.Effect === "Allow");
  for (const s of after.Statement) {
    if (s.Effect !== "Allow") continue;
    for (const a of toArray(s.Action)) {
      for (const r of toArray(s.Resource)) {
        const covered = beforeAllows.some(
          (b) =>
            toArray(b.Action).some((ba) => globMatch(ba, a, true)) &&
            toArray(b.Resource).some((br) => globMatch(br, r)) &&
            stableStringify(b.Condition) === stableStringify(s.Condition),
        );
        if (!covered) out.push(`${s.Sid ?? "(unnamed)"} grants ${a} on ${r}, which the original policy did not`);
      }
    }
  }
  return out;
}
