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
  "CWE-284": {
    rootCause:
      "The protected namespace's NetworkPolicy ingress rule uses an empty namespaceSelector ({}), which Kubernetes treats as matching every namespace rather than the single namespace the author intended.",
    attackPath:
      "A pod in the public namespace curls the protected canary's Service directly; the empty selector lets the request through despite the policy's intent to restrict ingress to the internal namespace only.",
    blastRadius:
      "Full read access to the protected canary's data from any namespace in the cluster, bypassing the intended public → internal → protected flow entirely.",
    recommendedFix:
      "Set namespaceSelector to matchLabels: {kubernetes.io/metadata.name: internal} so only the internal namespace is permitted.",
  },
  "CWE-269": {
    rootCause:
      "A Role granting get/list on Secrets in the protected namespace is bound to public-app-sa, the ServiceAccount auto-mounted into the public-facing app's own pods.",
    attackPath:
      "Any process with access inside a public-app pod reads its own mounted ServiceAccount token and calls the Kubernetes API directly — no network path to the canary Service is needed at all.",
    blastRadius:
      "Direct read access to every Secret in the protected namespace via the Kubernetes API, independent of network reachability — fixing NetworkPolicy alone would not close this path.",
    recommendedFix:
      "Remove the Role/RoleBinding granting public-app-sa access to protected secrets; set automountServiceAccountToken: false if the token isn't needed at all.",
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
