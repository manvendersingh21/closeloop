# CloseLoop Integration Contract — v1

Two people, one loop:

```
 Person B: Discovery agent            Person A: CloseLoop (remediation)
 ───────────────────────────          ─────────────────────────────────
 find + exploit IAM misconfig  ──1──▶ POST /api/handoffs  (exploit-handoff/v1)
                               ◀─2──  202 { job_id, result_url }
 poll for outcome              ──3──▶ GET  /api/jobs/{job_id}/result
                               ◀─4──  remediation-result/v1
 (stretch) independent re-test ──5──▶ re-run exploit, confirm "blocked"
```

The source of truth is `src/contracts/handoff.ts` (zod). JSON Schemas for any language are in
`contracts/schema/` (`pnpm contract:schema` regenerates them). Reference payloads are in `contracts/examples/`.

---

## 1. Who owns what

| | **Person A — CloseLoop** | **Person B — Discovery** |
|---|---|---|
| Builds | Ingest API, OpenAI policy rewrite, IAM simulator gate, apply + live verify, rollback, PR, ClickHouse writes, UI | Lab environment, finding + exploit agent, handoff emitter, (stretch) independent re-test |
| Owns files | `src/**`, `db/**`, `contracts/schema/**` (generated) | `discovery/**`, `lab/**` (Terraform/CDK), `contracts/examples/*.handoff.json` |
| Co-owned (both approve) | `contracts/CONTRACT.md`, `src/contracts/handoff.ts` | same |
| Demo role | Narrates fix → prove → ship | Narrates find → exploit |

Nobody edits the other person's files. Need something changed? Ask, or open a PR for them to merge.

## 2. Interface

### 2.1 Handoff (B → A)

```
POST {CLOSELOOP_URL}/api/handoffs
Authorization: Bearer {CLOSELOOP_INGEST_TOKEN}
Content-Type: application/json

<exploit-handoff/v1 body>
```

| Response | Meaning |
|---|---|
| `202` `{ job_id, finding_id, result_url }` | Accepted and queued |
| `200` same body | Same `finding_id` with identical payload already received (idempotent, returns the existing job) |
| `400` `{ error, issues[] }` | Failed schema validation; `issues` lists the zod paths |
| `401` | Missing or wrong token |
| `403` `{ error }` | Out of scope: not `authorized-lab` / `lab-owner-approved`, or account ID ≠ `LAB_AWS_ACCOUNT_ID` |
| `409` `{ error, job_id }` | Same `finding_id` with a *different* payload while a job is running |

### 2.2 Result (A → B, polled)

```
GET {CLOSELOOP_URL}/api/jobs/{job_id}/result
Authorization: Bearer {CLOSELOOP_INGEST_TOKEN}
```

Always returns `remediation-result/v1`. Poll every 2 s until `status != "in_progress"`. Terminal statuses:

| status | Meaning |
|---|---|
| `verified` | Every negative check denies and every positive/regression check allows, in simulation **and** live |
| `failed` | No passing patch within 3 attempts; nothing applied, or the change was reverted |
| `rolled_back` | Applied, but a live positive check failed, so the original policy was restored |
| `rejected` | Valid schema but not safe to act on (e.g. the offending policy isn't inline) |

### 2.3 Required fields B must provide (beyond the original draft)

| Field | Why A needs it |
|---|---|
| `scope.aws_account_id`, `scope.region` | Safety check plus SDK config |
| `target.role_name`, `target.principal_arn` | The role CloseLoop may modify, and nothing else |
| `target.offending_policy` `{type:"inline", policy_name, statement_sid}` | The exact policy and statement to change |
| `exploit.replay` | Machine-replayable exploit for the before/after proof |
| `verification.checks[]` | ≥1 `negative`/`deny` and ≥1 `positive`/`allow`. Without positive checks the "fix" could delete everything |
| `handoff.created_at` | ISO 8601 timestamp |

## 3. Lab rules (B provisions, A only touches what is listed)

1. **A dedicated sandbox AWS account only.** Never a personal or company production account.
2. The excessive permission lives in an **inline policy** on the workload role (that keeps `PutRolePolicy` edits and rollback simple).
3. Every lab resource carries the tag `closeloop-lab=true`.
4. B creates two roles for A:
   - `closeloop-remediator`: `iam:GetRolePolicy`, `iam:PutRolePolicy`, `iam:ListRolePolicies`, `iam:SimulatePrincipalPolicy`, `iam:SimulateCustomPolicy`, restricted to the workload role's ARN.
   - Trust on the workload role that allows `closeloop-remediator` to `sts:AssumeRole` (for live checks).
5. B owns a `lab/reset` script that restores the vulnerable policy, so the demo can be re-run as often as needed.

## 4. Shared config (`.env` on each machine, never committed)

| Var | Who sets it | Shared? |
|---|---|---|
| `CLOSELOOP_URL` | B (points at A's laptop or deployment) | — |
| `CLOSELOOP_INGEST_TOKEN` | A generates it | **Yes**, send to B via DM or password manager |
| `LAB_AWS_ACCOUNT_ID` | B | Yes |
| `AWS_*` / profile for `closeloop-remediator` | B creates, A uses | Yes, privately |
| `OPENAI_API_KEY` | A | No |
| `CLICKHOUSE_*` | A | Optional (read-only dashboards for B) |

ClickHouse has one writer: **CloseLoop**. It inserts the raw handoff into `closeloop.handoffs`, then writes `jobs`, `verification_checks` and `events`.

## 5. Changing this contract

- The checker is `pnpm test` (`src/contracts/handoff.test.ts`). Both examples must pass before anyone pushes a contract change.
- **Additive only within v1:** new *optional* fields are fine. Never rename, remove or retype a field.
- Breaking change → `exploit-handoff/v2`, and A's ingest must accept both until the demo ends.
- Any edit to `handoff.ts` or this file needs a thumbs-up from both people in chat before merging.
- Note: the JSON Schema export can't express two zod rules (≥1 negative/deny check, ≥1 positive/allow check). The API enforces them anyway.

## 6. Hack-day milestones

| By | Person A | Person B | Joint check |
|---|---|---|---|
| 11:30 | Contract frozen (this file) | Contract frozen | Both run `pnpm test` green |
| 12:15 | **Mock** ingest + result endpoints returning `FIND-001.result.json` | Lab provisioned, real handoff file emitted | B POSTs the real handoff to the mock → 202 |
| 13:30 | Real policy rewrite + simulator gate | Agent emits handoffs automatically | Simulated `verified` on a real finding |
| 15:00 | Live apply + verify + rollback, ClickHouse writes | `lab/reset` works; stretch: independent re-test | Full loop end-to-end ×3 in a row |
| 15:30 | **Feature freeze.** Bugs only | Feature freeze | Rehearse the 3-min demo |
| 16:00 | Record backup video | Record backup video | — |
| 16:30 | Submit | — | — |

If B is late, A keeps building against `contracts/examples/FIND-001.handoff.json`. If A is late, B tests against the mock from 12:15.
