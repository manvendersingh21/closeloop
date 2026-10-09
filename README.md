# CloseLoop

**Find. Fix. Prove. Ship.**

Verified autonomous remediation for the Cyberdefense Hackathon #SFTechWeek.

Frontier AI can draft patches — but the Berkeley/Google survey [*Frontier AI’s Impact on the Cybersecurity Landscape*](https://arxiv.org/pdf/2504.05408) shows **remediation deployment is empty** (0 benchmarks, 0 systems). CloseLoop closes that gap: every fix must pass a differential PoC (exploit works *before*, fails *after*), regressions, and a deployable CI gate.

One leg of a four-part team project (attack surface / attack / detection /
remediation — this repo is remediation). **[`attack-surface/`](attack-surface/)**
is the other half: a real Akash deployment and a real local Kubernetes
cluster, with live-exploited vulnerabilities. The `netpol-escape` and
`rbac-escape` fixtures below came directly from it — real findings,
exploited against a live cluster, not hypothetical.

## Demo (2 minutes)

```bash
cd closeloop
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000):

1. Pick a finding (XSS / path traversal / SQLi)
2. Click **Remediate & verify**
3. Watch triage → patch → PoC evidence → deploy package

Optional LLM rationales (NVIDIA NIM):

```bash
export NVIDIA_API_KEY=nvapi-...
pnpm dev
```

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Liveness + LLM availability |
| `GET` | `/api/findings` | Fixture findings |
| `POST` | `/api/remediate` | `{ "findingId": "finding-xss-001" }` |
| `GET` | `/api/jobs` | Remediation history |
| `GET` | `/api/jobs/:id` | Single job + evidence |

Fast mode for scripts:

```bash
curl -s -X POST http://localhost:3000/api/remediate \
  -H 'content-type: application/json' \
  -d '{"findingId":"finding-xss-001","fast":true}' | jq .job.status
```

## Tests

```bash
pnpm test
pnpm build
```

## Architecture

```
Finding (SARIF-like fixture)
   → Triage (root cause / attack path)
   → Patch (deterministic secure rewrite + optional NIM rationale)
   → Prove (differential PoC + regressions)
   → Ship (PR body + CI gate YAML + verify script)
```

Fixtures live in `src/lib/fixtures.ts`. Engine in `src/lib/engine/`. Jobs persist under `.closeloop-data/`.

## Why this wins

- Maps directly to **Autonomous Remediation** track
- Fills the survey’s sharpest gap (**Rem. Dep.**)
- Demo is visual: red exploit → green verified close
- Production-shaped artifacts judges can inspect (diff, CI, verify script)

## License

MIT — demo vulnerabilities are intentional fixtures; do not deploy them.
