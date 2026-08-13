# Staging Kubernetes Provisioning Commands

**Author:** Manus AI
**Scope:** Provision the namespace-scoped Secret, gateway ingress, CI deployer identity, and smoke-observer identity required by the secured staging workflow.

> Run these commands only against an authorized staging cluster. The commands never grant `cluster-admin`, `secrets get/list/watch`, or `pods/exec` to CI or smoke identities.

## 1. Operator Workstation Prerequisites

```bash
# Ubuntu/Debian operator host only. Skip if these commands already exist.
sudo apt-get update
sudo apt-get install -y kubectl gettext-base

cd /path/to/nexcomm
chmod 700 scripts/bootstrap-staging-kubernetes.sh \
  scripts/provision-staging-smoke-prerequisites.sh
```

Create untracked local inputs from the templates:

```bash
cp infra/staging/staging-bootstrap.env.template .staging-bootstrap.env
cp infra/staging/staging-secrets.env.template .env.staging.secrets
chmod 600 .staging-bootstrap.env .env.staging.secrets
```

Populate `.staging-bootstrap.env` with a real kubeconfig path and staging context. Populate `.env.staging.secrets` only from the approved secret manager. Do not use the template placeholders.

## 2. Establish the Authorized Context and Create the Staging Secret

```bash
set -a
source .staging-bootstrap.env
set +a

./scripts/bootstrap-staging-kubernetes.sh
```

The script applies `nexcom-staging-secrets` using the following exact client-side command. It is shown for auditability; use the script to preserve validation and output-file permissions.

```bash
kubectl -n nexcom-staging create secret generic nexcom-staging-secrets \
  --from-env-file=.env.staging.secrets \
  --dry-run=client -o yaml | kubectl apply -f -
```

Confirm that the Secret exists without printing its values:

```bash
kubectl -n nexcom-staging get secret nexcom-staging-secrets \
  -o jsonpath='{.metadata.name}{" keys: "}{range $k,$v := .data}{$k}{" "}{end}{"\n"}'
```

Do **not** export the operator bootstrap kubeconfig. Configure `STAGING_KUBECONFIG_B64` only from a separately issued `nexcom-staging-deployer` CI identity, or use the cluster provider’s GitHub OIDC workload-identity federation. The CI credential must be namespace-scoped and must not have Secret read/list/watch access.

## 3. Apply Least-Privilege CI and Smoke RBAC

```bash
kubectl apply -f infra/staging/manifests/staging-ci-rbac.yaml

# CI deployer: can manage only namespaced application resources and observe health.
kubectl auth can-i patch deployments -n nexcom-staging \
  --as=system:serviceaccount:nexcom-staging:nexcom-staging-deployer
kubectl auth can-i get secrets -n nexcom-staging \
  --as=system:serviceaccount:nexcom-staging:nexcom-staging-deployer

# Smoke observer: may observe workload health only.
kubectl auth can-i get pods -n nexcom-staging \
  --as=system:serviceaccount:nexcom-staging:nexcom-staging-smoke-observer
kubectl auth can-i create pods/exec -n nexcom-staging \
  --as=system:serviceaccount:nexcom-staging:nexcom-staging-smoke-observer
```

Expected results are `yes`, `no`, `yes`, and `no`, in that order. The deployer’s Helm client must set `HELM_DRIVER=configmap` so Helm release state does not require Secret access.

## 4. Provision the TLS Gateway URL

Set only real staging DNS and certificate values. The API gateway host must not reference production.

```bash
export STAGING_NAMESPACE=nexcom-staging
export STAGING_GATEWAY_HOST=staging.nexcom.example.com
export STAGING_TLS_SECRET=nexcom-tls-staging
export CERT_MANAGER_ISSUER=letsencrypt-staging-or-approved-cluster-issuer

./scripts/provision-staging-smoke-prerequisites.sh
```

For review before apply, render and inspect the Ingress:

```bash
envsubst < infra/staging/manifests/nexcom-staging-gateway-ingress.template.yaml \
  > /tmp/nexcom-staging-gateway-ingress.yaml
kubectl apply --dry-run=server -f /tmp/nexcom-staging-gateway-ingress.yaml
kubectl apply -f /tmp/nexcom-staging-gateway-ingress.yaml
kubectl -n nexcom-staging get ingress nexcom-staging-gateway -o wide
```

Obtain the ingress address and create the corresponding DNS record through the organization’s approved DNS control plane. The exact DNS command is provider-specific; do not invent a DNS API call with unverified credentials.

```bash
kubectl -n nexcom-staging get ingress nexcom-staging-gateway \
  -o jsonpath='{range .status.loadBalancer.ingress[*]}{.hostname}{.ip}{"\n"}{end}'
```

Create an `A` record for an IP address or a `CNAME` record for a load-balancer hostname. Wait for the TLS Secret and DNS propagation, then verify:

```bash
kubectl -n nexcom-staging get secret "$STAGING_TLS_SECRET"
curl --fail --silent --show-error --head "https://${STAGING_GATEWAY_HOST}/api/v1/health"
```

## 5. Configure CI and Execute Smoke Tests

Set the GitHub Environment variable:

```text
STAGING_GATEWAY_URL=https://staging.nexcom.example.com
```

Also set `STAGING_KEYCLOAK_URL`, `STAGING_PERMIFY_URL`, `STAGING_TEMPORAL_HEALTH_URL`, `STAGING_DAPR_HEALTH_URL`, and `STAGING_COSIGN_IDENTITY_REGEX`; add low-privilege `STAGING_TEST_USERNAME` and `STAGING_TEST_PASSWORD` as Environment secrets.

After deployment of 29 real signed image digests, run:

```bash
STAGING_GATEWAY_URL="https://${STAGING_GATEWAY_HOST}" \
STAGING_KEYCLOAK_URL="https://auth.staging.nexcom.example.com" \
STAGING_PERMIFY_URL="https://permify.staging.nexcom.example.com" \
STAGING_TEMPORAL_HEALTH_URL="https://temporal.staging.nexcom.example.com" \
STAGING_DAPR_HEALTH_URL="https://dapr-gateway.staging.nexcom.example.com" \
KEYCLOAK_REALM=nexcom \
STAGING_TEST_USERNAME="${STAGING_TEST_USERNAME}" \
STAGING_TEST_PASSWORD="${STAGING_TEST_PASSWORD}" \
python3 tests/integration/secured_staging_e2e.py
```

The expected post-deployment health collection is:

```bash
kubectl -n nexcom-staging get deployments,pods -o wide
kubectl -n nexcom-staging get events --sort-by=.lastTimestamp | tail -n 50
```
