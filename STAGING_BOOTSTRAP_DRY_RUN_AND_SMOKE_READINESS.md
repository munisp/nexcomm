# Secured Staging Bootstrap, Immutable Dry Run, and Smoke-Test Readiness

**Author:** Manus AI
**Scope:** Kubernetes context bootstrap, staging secrets, immutable image digest injection, local Helm simulation, and live smoke-test prerequisites.

> The local simulation completed successfully with **29 syntactically valid but deliberately non-resolvable `registry.example.invalid` image references**. It validates the CI/Helm wiring only. It is not a deployable manifest and did not contact a container registry or Kubernetes cluster.

## 1. Bootstrap Kubernetes Context and Staging Secrets

Copy the templates to untracked files and populate them through the approved secret manager. Do not place actual credentials in Git, CI logs, shell history, or `values-staging.yaml`.

```bash
cd /path/to/nexcomm
cp infra/staging/staging-bootstrap.env.template .staging-bootstrap.env
cp infra/staging/staging-secrets.env.template .env.staging.secrets
chmod 600 .staging-bootstrap.env .env.staging.secrets
# Populate both files from approved sources; never use the supplied empty values.
set -a
source .staging-bootstrap.env
set +a
./scripts/bootstrap-staging-kubernetes.sh
```

The bootstrap script performs the following non-destructive setup actions after validating the inputs: it selects the named Kubernetes context, confirms permission to read namespaces and create/patch Secrets, creates `nexcom-staging` if absent, and applies `nexcom-staging-secrets` from the local secret file. It does **not** export the operator kubeconfig; CI must use a separate namespace-scoped deployer identity or supported workload-identity federation.

| Input / output | Required setting | Intended destination |
|---|---|---|
| `STAGING_KUBECONFIG_FILE` | Existing operator kubeconfig file for the staging cluster | Local filesystem only |
| `STAGING_CONTEXT` | Context that targets staging—not production | Local kubeconfig |
| `STAGING_SECRETS_ENV_FILE` | Untracked fully populated secret file | Local filesystem only |
| `STAGING_KUBECONFIG_B64_OUT` | **Not used** | Operator credentials must never be exported to CI. Use a separate namespace-scoped CI deployer credential or cluster OIDC federation. |
| `STAGING_NAMESPACE` | `nexcom-staging` unless intentionally changed | Bootstrap script and deployment workflow |
| `STAGING_SECRET_NAME` | `nexcom-staging-secrets` unless intentionally changed | Helm `global.secretName` |

The required runtime Secret keys are listed in `infra/staging/staging-secrets.env.template`. The chart consumes sensitive values as mounted files using the `_FILE` convention. Before deploying every service, ensure its implementation supports `NAME_FILE` rather than expecting raw secret-valued environment variables.

## 2. GitHub Staging Environment Configuration

Create a protected GitHub Environment named **`staging`** and configure the following values.

| Type | Name | Purpose |
|---|---|---|
| Environment secret | `STAGING_KUBECONFIG_B64` | Base64 CI-only kubeconfig for `nexcom-staging-deployer`, issued by the cluster identity system; never copy an operator bootstrap kubeconfig. Prefer workload-identity federation where the cluster supports it. |
| Environment secret | `STAGING_SMOKE_USERNAME` | Dedicated, low-privilege Keycloak user. |
| Environment secret | `STAGING_SMOKE_PASSWORD` | Password for the dedicated test user. |
| Environment variable | `STAGING_COSIGN_IDENTITY_REGEX` | Regex for the trusted image-build workflow certificate identity. Empty values fail the deployment workflow. |
| Environment variable | `STAGING_GATEWAY_URL` | Public HTTPS gateway base URL. |
| Environment variable | `STAGING_KEYCLOAK_URL` | Public Keycloak base URL. |
| Environment variable | `STAGING_PERMIFY_URL` | Reachable Permify health endpoint base URL. |
| Environment variable | `STAGING_TEMPORAL_HEALTH_URL` | Reachable Temporal health endpoint base URL. |
| Environment variable | `STAGING_DAPR_HEALTH_URL` | Reachable Dapr health endpoint base URL. |

The CI job needs Kubernetes authorization to `get` pods, `get` deployments, and `patch`/update Deployments only in `nexcom-staging`; no cluster-admin capability is required.

## 3. Immutable Deployment Workflow

`.github/workflows/deploy-staging-immutable.yml` accepts an `image_digests_json` input from the trusted image-build workflow. `scripts/generate-staging-digest-values.mjs` requires **exactly 29** service keys and a full OCI reference of the following form:

```text
ghcr.io/owner/repository@sha256:<64-lowercase-hex-digest>
```

It rejects missing, extra, tag-only, malformed, or non-digest image references. The CI workflow then verifies every reference with Cosign, renders Helm with `global.requireImageDigest: true`, verifies all 29 rendered images are digests, performs an atomic Helm rollout, waits for all Deployments, and uploads the rendered values, signature records, smoke output, and `kubectl get deployments,pods -o wide` health evidence.

## 4. Local Immutable Helm Dry Run

The completed local simulation used the purpose-built mock generator:

```bash
node scripts/generate-local-mock-digests.mjs test-results/local-mock-image-digests.json
node scripts/generate-staging-digest-values.mjs \
  test-results/local-mock-image-digests.json \
  test-results/local-mock-digest-values.yaml
helm lint infra/helm/nexcom \
  -f infra/helm/nexcom/values-staging.yaml \
  -f test-results/local-mock-digest-values.yaml
helm template nexcom-staging infra/helm/nexcom \
  -f infra/helm/nexcom/values-staging.yaml \
  -f test-results/local-mock-digest-values.yaml \
  > test-results/immutable_helm_dry_run.yaml
```

| Assertion | Result |
|---|---:|
| Digest records provided to generator | 29 |
| Rendered digest image references | 29 |
| Rendered mutable image references | 0 |
| `registry.example.invalid` references | 29 |
| Registry or cluster contacted | 0 |

The values generated for this simulation contain only `example.invalid` images. They must never be copied into staging or CI deployment inputs.

## 5. Remaining Gaps Before Full End-to-End Smoke Execution

The current workspace cannot execute a live smoke test. The latest fail-closed result stopped at configuration preflight because `STAGING_GATEWAY_URL` is absent; Kubernetes tools and cluster credentials are also absent. The following closure conditions are required, in order.

| Priority | Gap | Required completion evidence |
|---|---|---|
| P0 | Real signed image digests for all 29 services | CI build artifacts contain 29 non-mock `@sha256` references and every Cosign verification succeeds against `STAGING_COSIGN_IDENTITY_REGEX`. |
| P0 | Authorized namespace-limited kubeconfig | Bootstrap succeeds; `kubectl auth can-i get pods -n nexcom-staging` and `kubectl auth can-i patch deployments -n nexcom-staging` return `yes`. |
| P0 | Staging Secret values | Bootstrap applies `nexcom-staging-secrets` without placeholders; Keycloak, database, Redis, Kafka, APISIX, and external provider credentials are valid. |
| P0 | Application `_FILE` adoption | Every deployed service resolves mounted secret file paths; container startup logs show no missing required raw variable. |
| P0 | Public and internal endpoint routing | APISIX exposes TLS-protected gateway and Keycloak routes; Permify, Temporal, and Dapr health endpoints are reachable by the CI runner. |
| P1 | Dapr dependency readiness | Redis state store, Kafka pub-sub, resiliency config, and each required sidecar report healthy. |
| P1 | Identity and authorization readiness | Keycloak realm import has completed; test user exists; gateway client and Permify relationships/policies are created. |
| P1 | Dedicated smoke identity | The test user is low-privilege, has no settlement/admin access, and can obtain a real Keycloak token. |
| P1 | Observability | APISIX/open-appsec/Wazuh and application logs are retained during rollout and smoke execution for correlation. |

When these conditions are met, source the real values from `infra/staging/staging-smoke.env.template` into the CI environment or an authorized operator shell, then run:

```bash
python3 tests/integration/secured_staging_e2e.py
```

A successful run must report HTTP 200 for gateway, Keycloak discovery, Permify, Temporal, and Dapr; an expected 401/403 for unauthenticated protected gateway health; a successful low-privilege login; and HTTP 200 for authenticated platform health. Any missing endpoint, dependency failure, unexpected success, invalid token, or denied health request yields a failure—no local fallback is used.

## 6. Current Workspace Evidence

The local environment has no `STAGING_GATEWAY_URL`, `KUBECONFIG`, `KUBE_CONTEXT`, installed `kubectl`, or reachable staging cluster. Accordingly, no container health status was fabricated. See the attached preflight and final smoke logs for exact evidence.
