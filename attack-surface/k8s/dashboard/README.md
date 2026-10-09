# Attack surface dashboard

A Svelte + Vite spectator UI for the Kubernetes lab in `../`. Two live
views, both backed by real data, nothing mocked:

- **View Environment** — `kubectl get events -A --watch`, streamed to the
  browser over Server-Sent Events. Shows pod/container lifecycle live.
  Known gap: it does not yet show the exploit traffic itself (plain
  pod-to-pod curls and Secret reads don't generate Kubernetes Events) — see
  `../README.md` for what closing that would take.
- **Customer Data** — the real `canary-api` dataset (30 fabricated
  records), fetched live through a `kubectl port-forward`, not a static
  copy baked into the page.

## Architecture

```
Svelte UI (:5173, Vite dev server)
      │  /api/* proxied (see vite.config.js)
      ▼
server.js (:4100, Express)
      │                              │
      │ spawns `kubectl get events   │ fetches
      │ -A --watch`, pipes lines     │ http://localhost:5678/customers
      ▼ as SSE                       ▼
  browser EventSource          kubectl port-forward → canary-api pod
```

## Running it

Three processes, in order:

```bash
# 1. expose the real protected service locally
kubectl --context kind-attack-sandbox port-forward -n protected svc/canary 5678:80 &

# 2. the API bridge (SSE + proxy)
node server.js &          # :4100

# 3. the UI itself
npm run dev                # :5173
```

Everything here reads from a live cluster — if the `kind-attack-sandbox`
context doesn't exist or the port-forward isn't running, the event feed
will show nothing and the Customer Data tab will show a clear
"canary-api unreachable" error with the exact command to fix it, not a
silent failure.
