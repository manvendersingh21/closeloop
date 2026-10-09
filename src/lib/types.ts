export type Severity = "critical" | "high" | "medium" | "low";

export type RemediationStatus =
  | "pending"
  | "triaging"
  | "patching"
  | "proving"
  | "shipping"
  | "verified"
  | "failed";

export type CweId = "CWE-79" | "CWE-22" | "CWE-89";

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  cwe: CweId;
  ruleId: string;
  file: string;
  startLine: number;
  endLine: number;
  message: string;
  fixtureId: string;
}

export interface TriageResult {
  rootCause: string;
  attackPath: string;
  blastRadius: string;
  recommendedFix: string;
  confidence: number;
}

export interface PatchResult {
  file: string;
  originalSnippet: string;
  patchedSnippet: string;
  unifiedDiff: string;
  rationale: string;
  llmAssisted: boolean;
}

export interface PocEvidence {
  label: string;
  beforeVulnerable: boolean;
  afterSecure: boolean;
  beforeOutput: string;
  afterOutput: string;
  durationMs: number;
}

export interface RegressionEvidence {
  name: string;
  passed: boolean;
  detail: string;
}

export interface DeployPackage {
  prTitle: string;
  prBody: string;
  ciGateYaml: string;
  verifyScript: string;
  rolloutNotes: string[];
}

export interface RemediationJob {
  id: string;
  findingId: string;
  status: RemediationStatus;
  createdAt: string;
  updatedAt: string;
  steps: { name: string; status: "done" | "active" | "pending" | "failed"; detail?: string }[];
  triage?: TriageResult;
  patch?: PatchResult;
  poc?: PocEvidence;
  regressions?: RegressionEvidence[];
  deploy?: DeployPackage;
  error?: string;
}

export interface FixtureApp {
  id: string;
  name: string;
  description: string;
  language: "javascript";
  entryFile: string;
  vulnerableSource: string;
  patchedSource: string;
  finding: Finding;
}
