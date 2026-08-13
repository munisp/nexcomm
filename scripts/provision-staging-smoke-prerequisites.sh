#!/usr/bin/env bash
# Provision namespace-scoped RBAC and the TLS gateway ingress required by the
# secured staging smoke workflow. Run bootstrap-staging-kubernetes.sh first.
#
# Required: STAGING_GATEWAY_HOST, STAGING_TLS_SECRET, CERT_MANAGER_ISSUER
# Optional: KUBECONFIG, STAGING_NAMESPACE (defaults to nexcom-staging)
set -euo pipefail

for tool in kubectl envsubst; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: $tool is required" >&2; exit 2; }
done
for variable in STAGING_GATEWAY_HOST STAGING_TLS_SECRET CERT_MANAGER_ISSUER; do
  [[ -n "${!variable:-}" ]] || { echo "ERROR: $variable is required" >&2; exit 2; }
done

namespace="${STAGING_NAMESPACE:-nexcom-staging}"
[[ "$namespace" == "nexcom-staging" ]] || { echo "ERROR: this manifest bundle is limited to nexcom-staging" >&2; exit 2; }

kubectl auth can-i create roles -n "$namespace" >/dev/null
kubectl auth can-i create rolebindings -n "$namespace" >/dev/null
kubectl auth can-i create serviceaccounts -n "$namespace" >/dev/null
kubectl auth can-i create ingresses.networking.k8s.io -n "$namespace" >/dev/null

kubectl apply -f infra/staging/manifests/staging-ci-rbac.yaml
export STAGING_GATEWAY_HOST STAGING_TLS_SECRET CERT_MANAGER_ISSUER
envsubst < infra/staging/manifests/nexcom-staging-gateway-ingress.template.yaml | kubectl apply -f -

kubectl get serviceaccount,role,rolebinding -n "$namespace" \
  -l app.kubernetes.io/part-of=nexcom
kubectl get ingress nexcom-staging-gateway -n "$namespace" -o wide

cat <<EOF
Provisioned Kubernetes objects. Complete DNS and smoke settings outside this script:
  1. Point ${STAGING_GATEWAY_HOST} to the APISIX ingress load-balancer address.
  2. Wait for TLS Secret ${STAGING_TLS_SECRET} to become Ready.
  3. Set GitHub Environment variable STAGING_GATEWAY_URL=https://${STAGING_GATEWAY_HOST}.
  4. Run the secured deployment workflow only after real signed image digests exist.
EOF
