# Secure Registry and Cosign Migration Guide

**Author:** Manus AI
**Purpose:** Replace the local-only `registry.example.invalid` mock references with real immutable OCI image digests, signed and verified for secured staging.

> The local mock digest files are test data only. Do not push to, sign, verify, or deploy `example.invalid` references. The deployment workflow intentionally rejects anything other than 29 full `registry/repository@sha256:<64-hex>` references.

## 1. Choose and Protect the Registry Namespace

This guide uses GitHub Container Registry as the concrete target. Replace `ghcr.io/${OWNER}` only if the organization has selected an alternative OCI registry with equivalent immutable digest and signature support.

```bash
export OWNER="<github-organization-or-user>"
export REGISTRY="ghcr.io/${OWNER}"
export RELEASE_SHA="$(git rev-parse --verify HEAD)"
```

Create or configure one private package per workload under the protected organization. Retention, immutable-tag, vulnerability scanning, and repository-to-package access policies must be configured at the registry layer. CI must be the only actor permitted to publish release images; staging deployment identities require pull-only access.

| Deployment service key | Real image repository |
|---|---|
| `nexcomExchange` | `${REGISTRY}/nexcom-exchange` |
| `matchingEngine` | `${REGISTRY}/matching-engine` |
| `tradingEngine` | `${REGISTRY}/trading-engine` |
| `riskManagement` | `${REGISTRY}/risk-management` |
| `kycService` | `${REGISTRY}/kyc-service` |
| `amlAlertSubscriber` | `${REGISTRY}/aml-alert-subscriber` |
| `analyticsEngine` | `${REGISTRY}/analytics-engine` |
| `analytics` | `${REGISTRY}/analytics` |
| `aiMl` | `${REGISTRY}/ai-ml` |
| `blockchain` | `${REGISTRY}/blockchain` |
| `botLogic` | `${REGISTRY}/bot-logic` |
| `channelGateway` | `${REGISTRY}/channel-gateway` |
| `coreBanking` | `${REGISTRY}/core-banking` |
| `creditScoring` | `${REGISTRY}/credit-scoring` |
| `cryptoGuard` | `${REGISTRY}/crypto-guard` |
| `ddosGuard` | `${REGISTRY}/ddos-guard` |
| `fluvioSidecar` | `${REGISTRY}/fluvio-sidecar` |
| `fraudEngine` | `${REGISTRY}/fraud-engine` |
| `indices` | `${REGISTRY}/indices` |
| `ingestionEngine` | `${REGISTRY}/ingestion-engine` |
| `marketData` | `${REGISTRY}/market-data` |
| `middlewareHub` | `${REGISTRY}/middleware-hub` |
| `mojaloopAdapter` | `${REGISTRY}/mojaloop-adapter` |
| `notification` | `${REGISTRY}/notification` |
| `opensearchSync` | `${REGISTRY}/opensearch-sync` |
| `pbac` | `${REGISTRY}/pbac` |
| `temporalWorkers` | `${REGISTRY}/temporal-workers` |
| `userManagement` | `${REGISTRY}/user-management` |
| `ussdEngine` | `${REGISTRY}/ussd-engine` |

## 2. Use GitHub OIDC Keyless Signing (Preferred)

The preferred design uses short-lived GitHub OIDC credentials rather than a long-lived private signing key. Sigstore documents the `cosign sign` and `cosign verify` container flow, including identity- and issuer-constrained verification. [1] The official installer’s GitHub Actions example requires `packages: write` to publish to GHCR and `id-token: write` for GitHub OIDC signing. [2]

Add the following job permissions to the trusted image build workflow:

```yaml
permissions:
  contents: read
  packages: write
  id-token: write
```

For each service image, build, push, capture the build output digest, and sign the full digest reference. The image must be pushed before signing.

```yaml
- name: Build and push one release image
  id: build
  uses: docker/build-push-action@v6
  with:
    context: ${{ matrix.context }}
    file: ${{ matrix.dockerfile }}
    push: true
    platforms: linux/amd64
    tags: ghcr.io/${{ github.repository_owner }}/${{ matrix.image }}:${{ github.sha }}

- name: Sign immutable image with GitHub OIDC
  env:
    IMAGE: ghcr.io/${{ github.repository_owner }}/${{ matrix.image }}@${{ steps.build.outputs.digest }}
  run: cosign sign --yes "$IMAGE"
```

The trusted build workflow must serialize every `service-key → image@sha256:…` result into the JSON consumed by the deployment workflow. For example:

```json
{
  "nexcomExchange": "ghcr.io/acme/nexcom-exchange@sha256:0123...64-hex-characters...cdef",
  "matchingEngine": "ghcr.io/acme/matching-engine@sha256:fedc...64-hex-characters...3210"
}
```

All **29** entries are required. Do not use a tag, a digest copied from a different repository, an abbreviated digest, an image index that was not signed, or an image that did not pass the build scanner.

Set the GitHub staging Environment variable below to the exact trusted workflow subject pattern, not a wildcard that accepts arbitrary repositories:

```text
STAGING_COSIGN_IDENTITY_REGEX=^https://github\.com/<OWNER>/<REPOSITORY>/\.github/workflows/<TRUSTED_BUILD_WORKFLOW>\.yml@refs/heads/main$
```

The existing deployment workflow verifies every reference using this identity pattern and the GitHub Actions issuer `https://token.actions.githubusercontent.com` before Helm deployment.

## 3. Optional Managed-Key Alternative

Use this only if organizational policy forbids keyless signing. Generate the key on a secure administrator workstation or hardware-backed signing system, **never in the repository or a shared runner**.

```bash
cosign generate-key-pair --output-key-prefix .staging-cosign
```

Store `.staging-cosign.key` and its passphrase only in the organization’s protected secret manager. Store `.staging-cosign.pub` in a reviewed repository path or policy configuration. The trusted build job signs the immutable image reference with:

```bash
cosign sign --yes --key env://COSIGN_PRIVATE_KEY "$IMAGE_URI_DIGEST"
```

The deployment workflow must then switch from certificate identity verification to:

```bash
cosign verify --key infra/policies/cosign/staging.pub "$IMAGE_URI_DIGEST"
```

Do not enable both verification modes as an OR condition; choose exactly one trusted verification policy. Rotate a managed key by adding the new public key to policy, signing a full release with the new key, migrating the deployment verifier, then revoking the old key only after rollback images have expired.

## 4. Replace Mock References With Real Image Digests

After all 29 signed images exist, capture the real references in a CI-only file or workflow output. Run the repository generator locally only for preflight; CI must supply the true JSON from the build job.

```bash
node scripts/generate-staging-digest-values.mjs \
  real-image-digests.json \
  generated-staging-digests.yaml
helm template nexcom-staging infra/helm/nexcom \
  -f infra/helm/nexcom/values-staging.yaml \
  -f generated-staging-digests.yaml > rendered-staging.yaml
```

Validate the exact output before deployment:

```bash
# Must print 29.
grep -c '@sha256:' rendered-staging.yaml
# Must print nothing.
grep -E '^\s+image: .*:' rendered-staging.yaml | grep -v '@sha256:'
# Must print nothing.
grep -F 'example.invalid' rendered-staging.yaml
```

The CI workflow at `.github/workflows/deploy-staging-immutable.yml` implements these checks and refuses a tag-only image input through the Helm guard. The correct invocation from a trusted workflow is:

```yaml
uses: ./.github/workflows/deploy-staging-immutable.yml
with:
  image_digests_json: ${{ needs.build-and-sign.outputs.image_digests_json }}
secrets: inherit
```

## 5. Migration Completion Checklist

| Step | Completion evidence |
|---|---|
| Registry packages created and protected | CI can push; runtime identity has pull-only access. |
| 29 image builds completed | Every service has a non-mock `image@sha256` reference. |
| Signatures verified | `cosign verify` passes with the pinned issuer and identity, or with the reviewed public key. |
| Staging Environment configured | `STAGING_COSIGN_IDENTITY_REGEX`, endpoint variables, and protected secrets are populated. |
| Values generated | Generator accepts exactly 29 entries; output contains no tag-only or `example.invalid` reference. |
| Policy verification | Helm digest gate and Gatekeeper reject a deliberately supplied tag. |
| Rollout evidence | Atomic Helm deployment, rollout status, pod health, and smoke logs are collected. |

## References

[1]: https://docs.sigstore.dev/quickstart/quickstart-cosign/ "Sigstore Quickstart with Cosign"
[2]: https://github.com/sigstore/cosign-installer "Cosign GitHub Action installer"
