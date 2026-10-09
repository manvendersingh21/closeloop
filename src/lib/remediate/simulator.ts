import { GetRolePolicyCommand, SimulateCustomPolicyCommand } from "@aws-sdk/client-iam";
import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import type { ExploitHandoffV1, VerificationCheck } from "@/contracts/handoff";
import type { CheckResult, PolicyDocument } from "@/contracts/internal";
import { iamClient, stsClient } from "@/lib/aws";
import { MOCK_POLICY, isMock } from "./config";
import { evaluateLocally, normalizePolicy } from "./policy";

/** Refuse to touch AWS unless our credentials are in the hand-off's lab account. */
export async function assertLabAccount(h: ExploitHandoffV1): Promise<void> {
  if (isMock()) return;
  const { Account } = await stsClient(h.scope.region).send(new GetCallerIdentityCommand({}));
  if (Account !== h.scope.aws_account_id) {
    throw new Error(`AWS credentials are for account ${Account}, hand-off targets ${h.scope.aws_account_id}`);
  }
}

export async function getCurrentPolicy(h: ExploitHandoffV1): Promise<PolicyDocument> {
  if (isMock()) return structuredClone(MOCK_POLICY);
  const { role_name, offending_policy } = h.target;
  const res = await iamClient(h.scope.region).send(
    new GetRolePolicyCommand({ RoleName: role_name, PolicyName: offending_policy.policy_name }),
  );
  if (!res.PolicyDocument) throw new Error(`inline policy ${offending_policy.policy_name} on ${role_name} is empty`);
  return normalizePolicy(JSON.parse(decodeURIComponent(res.PolicyDocument)));
}

async function decide(region: string, policy: PolicyDocument, c: VerificationCheck): Promise<"allow" | "deny"> {
  if (isMock()) return evaluateLocally(policy, c.action, c.resource);
  const res = await iamClient(region).send(
    new SimulateCustomPolicyCommand({
      PolicyInputList: [JSON.stringify(policy)],
      ActionNames: [c.action],
      ResourceArns: [c.resource],
    }),
  );
  const d = res.EvaluationResults?.[0]?.EvalDecision;
  if (!d) throw new Error("simulator returned no decision");
  return d === "allowed" ? "allow" : "deny";
}

/** Run checks against `policy` in the IAM policy simulator (or locally in mock mode). */
export async function simulate(
  h: ExploitHandoffV1,
  policy: PolicyDocument,
  checks: VerificationCheck[],
  phase: "baseline" | "simulate",
  attempt: number,
): Promise<CheckResult[]> {
  return Promise.all(
    checks.map(async (c): Promise<CheckResult> => {
      try {
        const actual = await decide(h.scope.region, policy, c);
        return { check_id: c.id, phase, attempt, expected: c.expect, actual, passed: actual === c.expect };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { check_id: c.id, phase, attempt, expected: c.expect, actual: "error", passed: false, detail };
      }
    }),
  );
}
