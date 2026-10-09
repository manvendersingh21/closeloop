# canary-api

The protected synthetic canary's actual service — the thing both K8s
escapes (`../00-04.yaml`) are trying to reach.

No app-level auth, on purpose: per the lab spec, protection is the infra
boundary (NetworkPolicy + RBAC), not the app. Reaching this at all already
means one of those controls failed.

## Endpoints

| Route | Returns |
|---|---|
| `GET /` | Service info + the NetworkPolicy-escape flag |
| `GET /customers` | All 30 fabricated customer records |
| `GET /customers/:id` | One record |

Data comes from `customers.json`, generated with a fixed random seed
(`seed=42`) — regenerate with the script in the top-level conversation
history if you need a different set, or just hand-edit the JSON.

## Building

No registry needed — built locally and loaded straight into the `kind`
cluster:

```bash
docker build -t canary-api:local .
kind load docker-image canary-api:local --name attack-sandbox
```

The `canary` Deployment in `../03-protected.yaml` references
`canary-api:local` with `imagePullPolicy: Never`, so it only ever runs the
image you just loaded — never pulls from anywhere.
