#!/usr/bin/env bash
# Creates a disposable local kind cluster for bootstrap/RBAC/Secret contract
# validation. It is not a live staging environment and does not validate real
# external services, durable financial flows, or production integrations.
set -euo pipefail

cluster="${LOCAL_KIND_CLUSTER_NAME:-nexcom-local-staging}"
namespace="${STAGING_NAMESPACE:-nexcom-staging}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
local_dir="$repo_root/.local"
kubeconfig="$local_dir/${cluster}.kubeconfig"
secret_file="$local_dir/.env.local-staging.secrets"

for tool in docker kind kubectl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: $tool is required" >&2; exit 2; }
done
docker info >/dev/null 2>&1 || { echo "ERROR: Docker daemon is unavailable" >&2; exit 2; }

mkdir -p "$local_dir"
chmod 700 "$local_dir"
kind delete cluster --name "$cluster" >/dev/null 2>&1 || true
kind create cluster \
  --name "$cluster" \
  --config "$repo_root/infra/local-kind/kind-config.yaml" \
  --kubeconfig "$kubeconfig" \
  --wait 5m
chmod 600 "$kubeconfig"

"$repo_root/scripts/generate-local-staging-secrets.sh" "$secret_file"
export STAGING_KUBECONFIG_FILE="$kubeconfig"
export STAGING_CONTEXT="kind-${cluster}"
export STAGING_SECRETS_ENV_FILE="$secret_file"
export STAGING_NAMESPACE="$namespace"
export STAGING_SECRET_NAME="nexcom-staging-secrets"
"$repo_root/scripts/bootstrap-staging-kubernetes.sh"

KUBECONFIG="$kubeconfig" kubectl apply -f "$repo_root/infra/staging/manifests/staging-ci-rbac.yaml"
{
  echo '=== LOCAL KIND BOOTSTRAP EVIDENCE ==='
  KUBECONFIG="$kubeconfig" kubectl get namespace "$namespace"
  KUBECONFIG="$kubeconfig" kubectl get secret nexcom-staging-secrets -n "$namespace" -o jsonpath='{.metadata.name}{" keys: "}{range $k,$v := .data}{$k}{" "}{end}{"\n"}'
  echo 'deployer_patch_deployments:'
  KUBECONFIG="$kubeconfig" kubectl auth can-i patch deployments -n "$namespace" --as="system:serviceaccount:${namespace}:nexcom-staging-deployer"
  echo 'deployer_get_secrets:'
  KUBECONFIG="$kubeconfig" kubectl auth can-i get secrets -n "$namespace" --as="system:serviceaccount:${namespace}:nexcom-staging-deployer"
  echo 'observer_get_pods:'
  KUBECONFIG="$kubeconfig" kubectl auth can-i get pods -n "$namespace" --as="system:serviceaccount:${namespace}:nexcom-staging-smoke-observer"
  echo 'observer_create_pod_exec:'
  KUBECONFIG="$kubeconfig" kubectl auth can-i create pods/exec -n "$namespace" --as="system:serviceaccount:${namespace}:nexcom-staging-smoke-observer"
} | tee "$repo_root/test-results/local_kind_bootstrap_rbac_evidence.log"

cat <<EOF
Local kind bootstrap complete. This validates Kubernetes Secret/RBAC application only.
Kubeconfig: $kubeconfig
To remove all local test data: kind delete cluster --name $cluster && rm -rf $local_dir
EOF
