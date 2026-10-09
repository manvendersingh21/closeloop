// Shared helpers for the Akash lab target (lab/api/server.mjs).
// The policy engine here is the exact code the deployed lab runs, so a local
// "simulation" with evaluateLab() decides the same way the live lab will.
import type { ExploitHandoffV1, VerificationCheck } from "@/contracts/handoff";
import type { PolicyDocument } from "@/contracts/internal";
// Plain ESM module shared with the container image.
import { evaluate } from "../../lab/api/server.mjs";

export type LabStatement = { sid?: string; effect: "allow" | "deny"; actions: string[]; resources: string[] };
export type LabPolicy = { statements: LabStatement[] };

const arr = (v: string | string[]) => ([] as string[]).concat(v);

export function toLabPolicy(p: PolicyDocument): LabPolicy {
  return {
    statements: p.Statement.map((s) => ({
      ...(s.Sid ? { sid: s.Sid } : {}),
      effect: s.Effect === "Deny" ? "deny" : "allow",
      actions: arr(s.Action),
      resources: arr(s.Resource),
    })),
  };
}

export function fromLabPolicy(p: LabPolicy): PolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: p.statements.map((s) => ({
      ...(s.sid ? { Sid: s.sid } : {}),
      Effect: s.effect === "deny" ? "Deny" : "Allow",
      Action: s.actions,
      Resource: s.resources,
    })),
  };
}

/** Decide a check offline with the lab's own policy engine. */
export function evaluateLab(policy: PolicyDocument, action: string, resource: string): "allow" | "deny" {
  return evaluate(toLabPolicy(policy), action, resource);
}

export interface LabTarget {
  dseq: string;
  service: string;
  policyEnvVar: string;
  baseUrl: string;
  token: string;
}

/** Server env first, hand-off `akash` block as fallback. The workload token only ever comes from env. */
export function resolveLabTarget(h: ExploitHandoffV1): LabTarget {
  const token = process.env.LAB_WORKLOAD_TOKEN;
  // Server config wins: a hand-off may never point the workload token at another host.
  const dseq = process.env.AKASH_LAB_DSEQ ?? h.akash?.dseq;
  const baseUrl = process.env.LAB_BASE_URL ?? h.akash?.base_url;
  if (!token) throw new Error("LAB_WORKLOAD_TOKEN is not set");
  if (!dseq) throw new Error("no Akash dseq: set AKASH_LAB_DSEQ or handoff.akash.dseq");
  if (!baseUrl) throw new Error("no lab URL: set LAB_BASE_URL or handoff.akash.base_url");
  if (h.akash && (h.akash.dseq !== dseq || new URL(h.akash.base_url).host !== new URL(baseUrl).host)) {
    throw new Error("hand-off names a different Akash deployment than the configured lab");
  }
  return {
    dseq,
    service: h.akash?.service ?? process.env.AKASH_LAB_SERVICE ?? "lab-api",
    policyEnvVar: h.akash?.policy_env_var ?? "POLICY_JSON",
    baseUrl: baseUrl.replace(/\/$/, ""),
    token,
  };
}

/** Map a check onto the lab's HTTP API. */
export function labRequest(c: Pick<VerificationCheck, "action" | "resource">): { method: string; path: string } | null {
  if (c.action === "data:read") return { method: "GET", path: `/data/${c.resource.split("/").map(encodeURIComponent).join("/")}` };
  if (c.action === "orders:write" && c.resource === "orders") return { method: "POST", path: "/orders" };
  return null;
}

/** Ask the running lab which policy it enforces (GET /whoami). */
export async function fetchLivePolicy(t: LabTarget): Promise<LabPolicy> {
  const res = await fetch(`${t.baseUrl}/whoami`, {
    headers: { authorization: `Bearer ${t.token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`lab /whoami → ${res.status}`);
  return ((await res.json()) as { policy: LabPolicy }).policy;
}
