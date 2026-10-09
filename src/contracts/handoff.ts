// Integration contract between the discovery agent (Person B) and CloseLoop (Person A).
// Source of truth for contracts/CONTRACT.md. Change only with both people's sign-off;
// `pnpm contract:schema` regenerates the JSON Schemas in contracts/schema/.
import { z } from "zod";

const Arn = z.string().regex(/^arn:aws[a-z-]*:[a-z0-9-]+:[a-z0-9-]*:\d{0,12}:.+$/, "must be an AWS ARN");
const IamAction = z.string().regex(/^[a-z0-9-]+:[A-Za-z0-9*]+$/, "must look like service:Action");
const Decision = z.enum(["allow", "deny"]);

/** One machine-executable check. CloseLoop runs every check in simulation and live. */
export const VerificationCheck = z.object({
  id: z.string().min(1),
  kind: z.enum(["negative", "positive", "regression"]),
  description: z.string().optional(),
  action: IamAction,
  resource: Arn,
  expect: Decision,
});

/** exploit-handoff/v1 — Person B → Person A. */
export const ExploitHandoffV1 = z.object({
  schema_version: z.literal("exploit-handoff/v1"),
  finding_id: z.string().regex(/^FIND-[A-Za-z0-9-]+$/),
  title: z.string().min(1),
  status: z.literal("validated"),
  severity: z.enum(["critical", "high", "medium", "low"]),

  scope: z.object({
    environment: z.literal("authorized-lab"),
    target_id: z.string().min(1),
    authorization: z.literal("lab-owner-approved"),
    aws_account_id: z.string().regex(/^\d{12}$/),
    region: z.string().min(1),
  }),

  vulnerability: z.object({
    category: z.literal("cloud-iam-misconfiguration"),
    cwe: z.string().regex(/^CWE-\d+$/),
    affected_component: z.string().min(1),
    description: z.string().min(1),
    root_cause_hypothesis: z.string().min(1),
  }),

  /** Exactly what CloseLoop is allowed to change. */
  target: z.object({
    principal_arn: Arn,
    role_name: z.string().min(1),
    protected_resource_arn: Arn,
    offending_policy: z.object({
      type: z.literal("inline"),
      policy_name: z.string().min(1),
      statement_sid: z.string().min(1),
    }),
  }),

  exploit: z.object({
    starting_position: z.string().min(1),
    preconditions: z.array(z.string()),
    steps: z
      .array(
        z.object({
          step: z.number().int().positive(),
          action: z.string().min(1),
          expected_observation: z.string().min(1),
        }),
      )
      .min(1),
    success_condition: z.string().min(1),
    observed_result: z.literal("success"),
    /** Machine-replayable form of the exploit. */
    replay: z.object({
      type: z.literal("aws_api"),
      assume_role_arn: Arn,
      action: IamAction,
      resource: Arn,
    }),
  }),

  evidence: z.object({
    reproduction_count: z.number().int().positive(),
    successful_reproductions: z.number().int().nonnegative(),
    artifacts: z.array(z.string()),
    confidence: z.number().min(0).max(1),
  }),

  remediation: z.object({
    desired_security_property: z.string().min(1),
    suggested_fix: z.string().min(1),
    constraints: z.array(z.string()),
  }),

  verification: z
    .object({
      negative_test: z.string().min(1),
      positive_test: z.string().min(1),
      regression_test: z.string().min(1),
      checks: z.array(VerificationCheck).min(2),
    })
    .refine((v) => v.checks.some((c) => c.kind === "negative" && c.expect === "deny"), {
      message: "needs at least one negative check expecting deny",
    })
    .refine((v) => v.checks.some((c) => c.kind === "positive" && c.expect === "allow"), {
      message: "needs at least one positive check expecting allow",
    }),

  handoff: z.object({
    owner: z.literal("remediation-agent"),
    state: z.literal("ready-for-remediation"),
    created_at: z.iso.datetime(),
  }),
});

const CheckResult = z.object({
  check_id: z.string().min(1),
  phase: z.enum(["baseline", "simulate", "live", "rollback"]),
  attempt: z.number().int().positive(),
  expected: Decision,
  actual: z.enum(["allow", "deny", "error"]),
  passed: z.boolean(),
  detail: z.string().optional(),
});

/** remediation-result/v1 — Person A → Person B (polled). */
export const RemediationResultV1 = z.object({
  schema_version: z.literal("remediation-result/v1"),
  job_id: z.string().min(1),
  finding_id: z.string().min(1),
  status: z.enum(["in_progress", "verified", "failed", "rolled_back", "rejected"]),
  stage: z.enum(["queued", "patching", "simulating", "applying", "verifying", "done"]),
  attempts: z.number().int().nonnegative(),
  change: z
    .object({
      type: z.literal("iam_inline_policy"),
      role_name: z.string(),
      policy_name: z.string(),
      before: z.record(z.string(), z.unknown()),
      after: z.record(z.string(), z.unknown()),
      summary: z.array(z.string()),
    })
    .nullable(),
  checks: z.array(CheckResult),
  exploit_replay: z.object({
    before: z.enum(["success", "blocked", "not_run"]),
    after: z.enum(["success", "blocked", "not_run"]),
  }),
  rationale: z.string(),
  pr_url: z.string().nullable(),
  error: z.string().nullable(),
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime().nullable(),
});

/** Response body of POST /api/handoffs. */
export const IngestAccepted = z.object({
  job_id: z.string().min(1),
  finding_id: z.string().min(1),
  result_url: z.string().min(1),
});

export type ExploitHandoffV1 = z.infer<typeof ExploitHandoffV1>;
export type RemediationResultV1 = z.infer<typeof RemediationResultV1>;
export type VerificationCheck = z.infer<typeof VerificationCheck>;
export type IngestAccepted = z.infer<typeof IngestAccepted>;
