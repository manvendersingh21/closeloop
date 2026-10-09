import type { Finding, PatchResult } from "../types";
import { getFixture } from "../fixtures";
import { maybeEnhanceRationale } from "./llm";

function extractSnippet(source: string, startLine: number, endLine: number): string {
  const lines = source.split("\n");
  const start = Math.max(0, startLine - 2);
  const end = Math.min(lines.length, endLine + 2);
  return lines.slice(start, end).join("\n");
}

function makeUnifiedDiff(
  file: string,
  before: string,
  after: string,
): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const lines = [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${a.length} +1,${b.length} @@`,
  ];
  // Simple full-file diff for fixture clarity in demos
  for (const line of a) lines.push(`-${line}`);
  for (const line of b) lines.push(`+${line}`);
  return lines.join("\n");
}

const RATIONALES: Record<Finding["cwe"], string> = {
  "CWE-79":
    "Introduced escapeHtml() and applied it to the name parameter before HTML emission, closing reflected XSS while preserving the greet response shape.",
  "CWE-22":
    "Added traversal guards, forced basename resolution under ROOT, and containment checks before fs.readFileSync.",
  "CWE-89":
    "Replaced concatenated SQL with a parameterized-style lookupUser() that compares usernames without interpreting attacker SQL.",
};

export async function generatePatch(finding: Finding): Promise<PatchResult> {
  const fixture = getFixture(finding.fixtureId);
  if (!fixture) {
    throw new Error(`Unknown fixture: ${finding.fixtureId}`);
  }

  const originalSnippet = extractSnippet(
    fixture.vulnerableSource,
    finding.startLine,
    finding.endLine,
  );
  const patchedSnippet = extractSnippet(
    fixture.patchedSource,
    Math.max(1, finding.startLine - 4),
    finding.endLine + 8,
  );

  const baseRationale = RATIONALES[finding.cwe];
  const { text, llmAssisted } = await maybeEnhanceRationale(
    finding,
    baseRationale,
  );

  return {
    file: finding.file,
    originalSnippet,
    patchedSnippet,
    unifiedDiff: makeUnifiedDiff(
      finding.file,
      fixture.vulnerableSource,
      fixture.patchedSource,
    ),
    rationale: text,
    llmAssisted,
  };
}
