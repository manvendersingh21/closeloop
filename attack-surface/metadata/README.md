# metadata

Simulates a cloud instance-metadata service (the AWS `169.254.169.254`
IMDS pattern). **Internal-only** — the Akash SDL (`../deploy.yaml`) exposes
this port only to `storefront`, never to the public internet; reaching it
at all means `storefront`'s SSRF bug (`../storefront/README.md`) was
successfully used as a pivot.

Vulnerability: **CWE-269**, insufficient privilege restriction. Any caller
that *can* reach this gets full fake "credentials" with no further
authentication — the real Capital One-breach pattern (SSRF → IMDS →
stolen credential).

| Route | Returns |
|---|---|
| `GET /latest/meta-data/iam/security-credentials/` | The fake role name |
| `GET /latest/meta-data/iam/security-credentials/deploy-role` | Fake AWS-shaped credential JSON, `Token` shared via the `IAM_TOKEN` env var with `internal-api` |

`npm start` runs it on `:4001` (or `$PORT`). Nothing here is a real credential.
