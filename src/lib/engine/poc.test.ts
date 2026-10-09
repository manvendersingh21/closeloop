import { describe, expect, it } from "vitest";
import { listFindings } from "../fixtures";
import { isVerified, runPoc, runRegressions } from "./poc";
import { triageFinding } from "./triage";
import { generatePatch } from "./patch";
import { buildDeployPackage } from "./deploy";

describe("CloseLoop PoC gate", () => {
  for (const finding of listFindings()) {
    it(`proves ${finding.cwe} closed after patch`, () => {
      const poc = runPoc(finding);
      const regressions = runRegressions(finding);
      expect(poc.beforeVulnerable).toBe(true);
      expect(poc.afterSecure).toBe(true);
      expect(regressions.every((r) => r.passed)).toBe(true);
      expect(isVerified(poc, regressions)).toBe(true);
    });
  }
});

describe("triage + patch + deploy package", () => {
  it("builds a complete verified package for XSS fixture", async () => {
    const finding = listFindings().find((f) => f.cwe === "CWE-79");
    expect(finding).toBeTruthy();
    if (!finding) return;

    const triage = triageFinding(finding);
    expect(triage.confidence).toBeGreaterThan(0.8);

    const patch = await generatePatch(finding);
    expect(patch.unifiedDiff).toContain("--- a/");
    expect(patch.patchedSnippet.length).toBeGreaterThan(20);

    const poc = runPoc(finding);
    const deploy = buildDeployPackage(finding, patch, poc);
    expect(deploy.prTitle).toContain("CWE-79");
    expect(deploy.ciGateYaml).toContain("closeloop-security-gate");
    expect(deploy.verifyScript).toContain("CloseLoop");
  });
});
