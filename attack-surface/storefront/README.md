# storefront

The public, intentionally-vulnerable entry point of the Akash chain. See
`../README.md` for the full chain and how to exploit it end to end.

Two deliberate bugs:

| Route | Bug | CWE |
|---|---|---|
| `GET /search?q=` | Reflected XSS — warm-up bug, steals a `session` cookie (a fake flag) | CWE-79 |
| `GET /preview?url=` | SSRF — fetches any attacker-supplied URL server-side with no allowlist and no block on internal hosts. This is the pivot that reaches `metadata`/`internal-api`, which aren't exposed publicly | CWE-918 |

`npm start` runs it on `:8080` (or `$PORT`). Built via `.github/workflows/build.yml` → `ghcr.io/divyanaras/attack-sandbox-storefront`.
