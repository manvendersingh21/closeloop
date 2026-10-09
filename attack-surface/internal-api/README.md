# internal-api

The "crown jewel" of the Akash chain. **Internal-only** — only
`storefront` can reach it (see `../deploy.yaml`), so getting here already
required pivoting through its SSRF bug.

| Route | Bug | CWE |
|---|---|---|
| `GET /internal/admin` (token via `Authorization: Bearer` or `?token=`) | Accepts whatever credential `metadata` hands out, with no further check — the payoff of the SSRF → metadata → admin chain. Returns the flag and 3 fake customer records | CWE-269 |
| `GET /internal/users/:id` | No auth at all — returns any user's fake record by incrementing the id | CWE-639 (IDOR) |

Token is shared with `metadata` via the `IAM_TOKEN` env var (set identically on both in `../deploy.yaml`) — a static, long-lived credential baked into deployment config, itself a realistic misconfiguration.

`npm start` runs it on `:4000` (or `$PORT`). Every "customer," "flag," and credential here is fabricated.
