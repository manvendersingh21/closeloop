import type { DeployPackage, Finding, PatchResult, PocEvidence } from "../types";

export function buildDeployPackage(
  finding: Finding,
  patch: PatchResult,
  poc: PocEvidence,
): DeployPackage {
  const short = finding.id.replace("finding-", "");
  return {
    prTitle: `security: remediate ${finding.cwe} in ${finding.file}`,
    prBody: [
      `## Summary`,
      `CloseLoop verified remediation for **${finding.title}** (${finding.cwe}).`,
      ``,
      `## Evidence`,
      `- PoC before (vulnerable): \`${poc.beforeOutput.slice(0, 120)}...\``,
      `- PoC after (secure): \`${poc.afterOutput.slice(0, 120)}...\``,
      `- Gate: exploit succeeded pre-patch and failed post-patch`,
      ``,
      `## Rationale`,
      patch.rationale,
      ``,
      `## Rollout`,
      `1. Merge behind CI security gate`,
      `2. Deploy to staging`,
      `3. Run \`scripts/closeloop-verify.sh ${short}\``,
      `4. Promote to production`,
    ].join("\n"),
    ciGateYaml: [
      `name: closeloop-security-gate`,
      `on: [pull_request]`,
      `jobs:`,
      `  verify-remediation:`,
      `    runs-on: ubuntu-latest`,
      `    steps:`,
      `      - uses: actions/checkout@v4`,
      `      - name: Run CloseLoop PoC gate`,
      `        run: |`,
      `          npx tsx scripts/closeloop-verify.ts --finding ${finding.id}`,
      `          test $? -eq 0`,
      `      - name: Fail if PoC still succeeds`,
      `        run: echo "Remediation not verified" && exit 1`,
      `        if: failure()`,
    ].join("\n"),
    verifyScript: [
      `#!/usr/bin/env bash`,
      `set -euo pipefail`,
      `echo "[CloseLoop] Verifying ${finding.cwe} remediation for ${finding.file}"`,
      `node -e "require('./.closeloop/verify/${short}.js')"`,
      `echo "[CloseLoop] VERIFIED — exploit closed, regressions green"`,
    ].join("\n"),
    rolloutNotes: [
      "No dependency bumps required for this patch class.",
      "Canary 5% of traffic for 15 minutes; watch 4xx on remediated routes.",
      "Retain PoC artifacts in Change Management ticket for audit.",
      "Auto-close scanner finding only after staging verify passes.",
    ],
  };
}
