import type { Finding, TriageResult } from "../types";
import { getFixture } from "../fixtures";

const PLAYBOOKS: Record<
  Finding["cwe"],
  Omit<TriageResult, "confidence">
> = {
  "CWE-79": {
    rootCause:
      "Untrusted query input is concatenated into an HTML response without encoding.",
    attackPath:
      "Attacker crafts a URL with a script payload in ?name= → victim browser executes attacker JS in app origin.",
    blastRadius:
      "Session theft, account takeover, and malware delivery for any authenticated greeter user.",
    recommendedFix:
      "HTML-escape all dynamic values before embedding in HTML, or render via a safe templating context.",
  },
  "CWE-22": {
    rootCause:
      "User-controlled file path is joined into a filesystem read without canonicalization or allowlisting.",
    attackPath:
      "Attacker supplies ../ sequences (or absolute paths) to read secrets outside the intended directory.",
    blastRadius:
      "Disclosure of credentials, source, and host configuration; foothold for further compromise.",
    recommendedFix:
      "Reject path separators / traversal tokens, resolve with basename under a fixed root, verify containment.",
  },
  "CWE-89": {
    rootCause:
      "SQL query is built via string concatenation of request parameters.",
    attackPath:
      "Attacker injects boolean tautologies (e.g. ' OR '1'='1) to dump unauthorized rows.",
    blastRadius:
      "Full table disclosure, auth bypass, and potential write/delete if statements are extended.",
    recommendedFix:
      "Use parameterized queries / bound lookups; never interpolate untrusted strings into SQL.",
  },
};

export function triageFinding(finding: Finding): TriageResult {
  const fixture = getFixture(finding.fixtureId);
  const playbook = PLAYBOOKS[finding.cwe];
  const hasSource = Boolean(fixture?.vulnerableSource);
  return {
    ...playbook,
    confidence: hasSource ? 0.94 : 0.72,
  };
}
