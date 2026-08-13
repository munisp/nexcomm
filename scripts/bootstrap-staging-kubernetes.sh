#!/usr/bin/env bash
# Bootstrap an authorized local Kubernetes context and the staging Secret used by
# the secured Helm chart. This script never generates or prints credentials.
#
# Required environment:
#   STAGING_KUBECONFIG_FILE   Existing kubeconfig file for the staging cluster.
#   STAGING_SECRETS_ENV_FILE  Untracked KEY=VALUE file containing staging secrets.
# Optional environment:
#   STAGING_NAMESPACE         Defaults to nexcom-staging.
#   STAGING_CONTEXT           Explicit kubeconfig context name.
#   STAGING_SECRET_NAME       Defaults to nexcom-staging-secrets.
#
# This operator bootstrap kubeconfig must never be exported to CI. Configure the
# deployment workflow with a separate least-privilege workload identity.
#
# Example:
#   STAGING_KUBECONFIG_FILE=~/.kube/nexcom-staging.yaml \
#   STAGING_SECRETS_ENV_FILE=./.env.staging.local \
#   ./scripts/bootstrap-staging-kubernetes.sh
set -euo pipefail

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name is required" >&2
    exit 2
  fi
}

for tool in kubectl base64 mktemp; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: $tool is required" >&2; exit 2; }
done

require STAGING_KUBECONFIG_FILE
require STAGING_SECRETS_ENV_FILE

namespace="${STAGING_NAMESPACE:-nexcom-staging}"
secret_name="${STAGING_SECRET_NAME:-nexcom-staging-secrets}"
source_kubeconfig="$(realpath "$STAGING_KUBECONFIG_FILE")"
secrets_file="$(realpath "$STAGING_SECRETS_ENV_FILE")"

[[ -r "$source_kubeconfig" ]] || { echo "ERROR: kubeconfig is not readable: $source_kubeconfig" >&2; exit 2; }
[[ -r "$secrets_file" ]] || { echo "ERROR: secret environment file is not readable: $secrets_file" >&2; exit 2; }

# The resulting file is process-private and removed on script exit.
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
export KUBECONFIG="$workdir/kubeconfig"
install -m 0600 "$source_kubeconfig" "$KUBECONFIG"

if [[ -n "${STAGING_CONTEXT:-}" ]]; then
  kubectl config use-context "$STAGING_CONTEXT" >/dev/null
fi
context="$(kubectl config current-context)"
[[ -n "$context" ]] || { echo "ERROR: no Kubernetes context selected" >&2; exit 2; }

kubectl auth can-i get namespaces >/dev/null
kubectl auth can-i create secrets -n "$namespace" >/dev/null
kubectl auth can-i patch secrets -n "$namespace" >/dev/null
kubectl get namespace "$namespace" >/dev/null 2>&1 || kubectl create namespace "$namespace"

# Reject malformed or source-controlled template values before passing data to
# Kubernetes. The actual Secret file must not be committed to the repository.
if grep -Eq '^\s*(#|$)' "$secrets_file"; then
  : # comments and blank lines are supported by kubectl --from-env-file.
fi
if grep -Eq 'replace-with-|<[^>]+>|^STAGING_KUBECONFIG_B64=' "$secrets_file"; then
  echo "ERROR: staging secret file contains placeholder values or CI kubeconfig data" >&2
  exit 2
fi

kubectl create secret generic "$secret_name" \
  --namespace "$namespace" \
  --from-env-file="$secrets_file" \
  --dry-run=client -o yaml | kubectl apply -f -

printf 'Kubernetes context configured: %s\n' "$context"
printf 'Staging secret applied: %s/%s\n' "$namespace" "$secret_name"
printf 'Secret keys present: %s\n' "$(kubectl get secret "$secret_name" -n "$namespace" -o jsonpath='{range $k,$v := .data}{$k}{" "}{end}')"
