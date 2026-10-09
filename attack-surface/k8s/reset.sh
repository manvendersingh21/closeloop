#!/usr/bin/env bash
# Reset the attack surface to its clean, known-vulnerable starting state.
#
# Patrick's going to compromise this repeatedly — his RBAC escape alone
# lets him read (and potentially tamper with) things in `protected`, and a
# fuller compromise could touch more. Run this between attack runs to wipe
# everything back to exactly what's in these manifests, every time.
#
# Usage: ./reset.sh
set -euo pipefail
cd "$(dirname "$0")"
CTX="kind-attack-sandbox"

echo "== deleting public, internal, protected namespaces (and everything in them) =="
kubectl --context "$CTX" delete namespace public internal protected --ignore-not-found --wait=true

echo "== reapplying clean manifests =="
kubectl --context "$CTX" apply \
  -f 00-namespaces.yaml \
  -f 01-public.yaml \
  -f 02-internal.yaml \
  -f 03-protected.yaml \
  -f 04-rbac-escape.yaml

echo "== waiting for all pods to be Ready =="
kubectl --context "$CTX" wait --for=condition=Ready pod --all \
  -n public -n internal -n protected --timeout=120s

echo
echo "== clean vulnerable state restored =="
kubectl --context "$CTX" get pods -n public -n internal -n protected
