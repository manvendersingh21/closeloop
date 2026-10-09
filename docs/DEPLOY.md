# Deploying CloseLoop to Akash

The app runs as one container: the Next.js standalone server (`node server.js`) on port 3000, as a non-root user. Akash exposes it on port 80.

Files involved:

| File | Purpose |
| --- | --- |
| `Dockerfile`, `.dockerignore` | Multi-stage image build (node:22-alpine, pnpm via corepack) |
| `.github/workflows/closeloop-image.yml` | CI build and push to `ghcr.io/<owner>/closeloop:<sha>` and `:latest` |
| `lab/akash/closeloop.sdl.yaml` | SDL template with `<PLACEHOLDER>` env values |
| `scripts/render-sdl.mjs` | Fills placeholders from `.env` into a copy outside the repo |
| `src/app/api/health/route.ts` | `GET /api/health` reports `ready` and env presence (names only) |

## 1. Build the image

CI builds on every push that touches `src/`, `package.json`, `pnpm-lock.yaml`, `Dockerfile` or `next.config.ts` (or run the workflow by hand from the Actions tab). It pushes:

- `ghcr.io/manvendersingh21/closeloop:<git sha>`
- `ghcr.io/manvendersingh21/closeloop:latest`

The package must be **public** on GHCR (Package settings, Change visibility) or Akash providers cannot pull it.

For a reproducible deploy, change `image:` in the SDL to the `:<sha>` tag instead of `:latest`.

Local check:

```bash
docker build -t closeloop:local .
docker run --rm -p 3300:3000 closeloop:local
curl -s localhost:3300/api/health
```

## 2. Render the SDL

The template holds only placeholders. Render a filled copy **outside** the repo:

```bash
node scripts/render-sdl.mjs lab/akash/closeloop.sdl.yaml /tmp/closeloop.sdl.yaml
```

It reads `.env` (via `process.loadEnvFile`) or the current environment, refuses to write inside the repo, writes the file with mode 600 and prints only the output path plus which placeholder names were filled or missing. It exits with code 3 when any placeholder is missing. Unfilled placeholders stay as `<NAME>` in the output, so fix them before deploying.

Env vars in the template:

- Required for `ready: true`: `OPENAI_API_KEY`, `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE`, `CLOSELOOP_INGEST_TOKEN`, `AKASH_CONSOLE_API_KEY`, `LAB_BASE_URL`, `LAB_WORKLOAD_TOKEN`
- Optional: `AKASH_LAB_DSEQ`, `GUILD_AI_API_KEY`, `GUILD_OWNER`, `GUILD_WORKSPACE`, `GUILD_REVIEWER_AGENT`, `GITHUB_TOKEN`, `CLOSELOOP_PR_REPO`

Delete the rendered file once the deployment is created: `rm /tmp/closeloop.sdl.yaml`.

## 3. Deploy

### Option A: Akash Console (UI)

1. Open console.akash.network, Deploy, "Build your template", switch to the YAML editor.
2. Paste the contents of the rendered `/tmp/closeloop.sdl.yaml`.
3. Create the deployment, pick a bid (provider), accept the lease.
4. Copy the service URI from the lease's "Leases" panel.

### Option B: Akash Console API

All calls go to `https://console-api.akash.network` with header `x-api-key: $AKASH_CONSOLE_API_KEY`.

```bash
API=https://console-api.akash.network
H=(-H "x-api-key: $AKASH_CONSOLE_API_KEY" -H "content-type: application/json")

# 3a. Create the deployment (deposit in the same denom as the SDL pricing)
jq -n --rawfile sdl /tmp/closeloop.sdl.yaml '{data:{sdl:$sdl, deposit:5}}' \
  | curl -s "${H[@]}" -X POST "$API/v1/deployments" -d @- | tee /tmp/closeloop-deploy.json
DSEQ=$(jq -r '.data.dseq' /tmp/closeloop-deploy.json)
MANIFEST=$(jq -r '.data.manifest' /tmp/closeloop-deploy.json)

# 3b. Wait ~30s, then list bids
curl -s "${H[@]}" "$API/v1/bids?dseq=$DSEQ" | jq '.data[] | {provider: .bid.id.provider, gseq: .bid.id.gseq, oseq: .bid.id.oseq, price: .bid.price}'

# 3c. Accept a bid by creating the lease
jq -n --arg m "$MANIFEST" --arg d "$DSEQ" --arg p "<provider address>" \
  '{manifest:$m, leases:[{dseq:$d, gseq:1, oseq:1, provider:$p}]}' \
  | curl -s "${H[@]}" -X POST "$API/v1/leases" -d @-

# 3d. Read the service URI
curl -s "${H[@]}" "$API/v1/deployments/$DSEQ" | jq '.data.leases[].status.services'
```

Check the Console API reference for exact request/response field names if they differ from the above. `/tmp/closeloop-deploy.json` contains the manifest (and therefore secrets): delete it when done.

## 4. Verify

```bash
curl -s http://<service-uri>/api/health | jq
```

Expect `ok: true` and `ready: true`. `config` maps each env var name to `true`/`false` (presence only, values are never returned). Any `false` among the required set means `ready: false`: fix the SDL and update the deployment (step 5).

Note: run state written by `src/lib/store.ts` lives under `/app/.closeloop-data` inside the container and is lost when the lease is closed or the container restarts. Durable evidence goes to ClickHouse.

## 5. Rotate secrets / update

1. Rotate the secret at its source (OpenAI, ClickHouse, Akash Console, GitHub, Guild) and update `.env`.
2. Re-render: `node scripts/render-sdl.mjs lab/akash/closeloop.sdl.yaml /tmp/closeloop.sdl.yaml`.
3. Update the deployment in place: Console, deployment, "Update" with the new SDL; or `PUT /v1/deployments/$DSEQ` with `{"data":{"sdl": "..."}}`. The provider restarts the container with the new env.
4. Revoke the old secret, then confirm `/api/health` still shows `ready: true`.
5. `rm /tmp/closeloop.sdl.yaml`.

If a secret leaked, rotate first and close the deployment (step 6) if the old value cannot be revoked immediately.

## 6. Close deployments to stop billing

A deployment bills every block until closed, whether or not it is used.

```bash
curl -s "${H[@]}" -X DELETE "$API/v1/deployments/$DSEQ"
```

Or in the Console: deployment, "Close". Remaining escrow is returned. Check the Console's deployment list periodically for forgotten deployments (including the lab and the test LLM from `lab/akash/`).
