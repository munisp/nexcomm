# Local kind or minikube Bootstrap Guide

**Author:** Manus AI
**Purpose:** Create a disposable local Kubernetes cluster to validate the NEXCOMM Kubernetes **bootstrap, Secret, and least-privilege RBAC contracts**. This guide does not establish live staging, real Keycloak/Permify/Temporal/Dapr interoperability, durable financial processing, or release evidence.

> A local cluster is an isolated test environment. It must never use production credentials, real funds, shared staging DNS, or images that are not explicitly intended for local testing.

## 1. Choose a Local Runtime

The default option is **kind**, which runs Kubernetes nodes through a local container runtime and supports a named cluster plus a dedicated kubeconfig. Its official guide documents the Linux binary installation and `kind create cluster --name … --wait …` flow. [1] Minikube with the Docker driver is an alternative; its official documentation requires a working Docker installation and documents `minikube start --driver=docker`. [2]

| Choice | Use when | Do not use when |
|---|---|---|
| kind | You need a disposable cluster for the repository’s RBAC/Secret/Helm contract validation. | Docker is unavailable or the host lacks at least 4 GB free memory for a minimal test environment. |
| minikube (Docker driver) | You prefer minikube tooling or local addons. | Docker is unavailable or you need a faithful full distributed staging topology. |
| Real isolated staging | You require Keycloak, Permify, Temporal, Dapr, TigerBeetle, Kafka/Fluvio, and PostgreSQL integration evidence. | You only need local manifest/RBAC/Secret validation. |

## 2. Install the Prerequisites on a Developer Host

The following commands are for an Ubuntu/Debian developer workstation. Run them in a shell that has permission to use Docker; log out and back in after adding your user to the Docker group.

```bash
sudo apt-get update
sudo apt-get install -y docker.io curl ca-certificates gettext-base openssl
sudo usermod -aG docker "$USER"
newgrp docker

docker info
```

Install `kubectl` with a verified current stable binary:

```bash
KUBECTL_VERSION="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"
curl -fsSLO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"
curl -fsSLO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl.sha256"
echo "$(cat kubectl.sha256)  kubectl" | sha256sum --check
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
rm -f kubectl kubectl.sha256
kubectl version --client
```

Install kind using the official Linux release-binary pattern. The referenced kind Quick Start documents `v0.32.0`; review the linked release notes before changing that pinned version. [1]

```bash
KIND_VERSION=v0.32.0
curl -fsSLo kind "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-amd64"
chmod +x kind
sudo install -o root -g root -m 0755 kind /usr/local/bin/kind
rm -f kind
kind version
```

## 3. Create the Disposable kind Cluster and Apply Bootstrap Resources

Clone or open the audited repository revision, then run the repository-owned local bootstrap script.

```bash
cd /path/to/nexcomm
chmod 700 scripts/bootstrap-local-kind-staging.sh scripts/generate-local-staging-secrets.sh
./scripts/bootstrap-local-kind-staging.sh
```

The script performs these controlled actions in a cluster named `nexcom-local-staging`: it creates the cluster from `infra/local-kind/kind-config.yaml`, writes a local kubeconfig and ephemeral test-only secret input beneath ignored `.local/`, runs `bootstrap-staging-kubernetes.sh`, applies `staging-ci-rbac.yaml`, and records a no-secret-value evidence log at `test-results/local_kind_bootstrap_rbac_evidence.log`.

Inspect the expected state with:

```bash
export KUBECONFIG="$PWD/.local/nexcom-local-staging.kubeconfig"
kubectl get namespace nexcom-staging
kubectl get serviceaccount,role,rolebinding -n nexcom-staging
kubectl get secret nexcom-staging-secrets -n nexcom-staging \
  -o jsonpath='{.metadata.name}{" keys: "}{range $k,$v := .data}{$k}{" "}{end}{"\n"}'

kubectl auth can-i patch deployments -n nexcom-staging \
  --as=system:serviceaccount:nexcom-staging:nexcom-staging-deployer
kubectl auth can-i get secrets -n nexcom-staging \
  --as=system:serviceaccount:nexcom-staging:nexcom-staging-deployer
kubectl auth can-i get pods -n nexcom-staging \
  --as=system:serviceaccount:nexcom-staging:nexcom-staging-smoke-observer
kubectl auth can-i create pods/exec -n nexcom-staging \
  --as=system:serviceaccount:nexcom-staging:nexcom-staging-smoke-observer
```

The expected authorization results are `yes`, `no`, `yes`, and `no`. A different outcome is a bootstrap/RBAC failure and must be investigated before using the local cluster further.

## 4. Optional minikube Alternative

After Docker and `kubectl` are installed, install minikube from its official release source appropriate to your CPU architecture, then start a named local profile. [2]

```bash
curl -fsSLo minikube https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install -o root -g root -m 0755 minikube /usr/local/bin/minikube
rm -f minikube

minikube start --driver=docker --profile=nexcom-local-staging --cpus=4 --memory=6144mb
kubectl config use-context nexcom-local-staging
```

For minikube, set `STAGING_KUBECONFIG_FILE` to the config file that contains the `nexcom-local-staging` context, generate a local-only secret file with `scripts/generate-local-staging-secrets.sh`, and then run `scripts/bootstrap-staging-kubernetes.sh` followed by `kubectl apply -f infra/staging/manifests/staging-ci-rbac.yaml`. The kind wrapper script is intentionally not used for minikube because it creates a kind cluster.

## 5. Complete `.env.staging` Configuration

Create an untracked local configuration file from the reviewed template.

```bash
cp .env.staging.template .env.staging
chmod 600 .env.staging
```

For a real isolated staging run, populate every credential and endpoint from the approved secret manager. In particular, set these smoke variables to actual HTTPS endpoints before invoking `tests/integration/secured_staging_e2e.py`:

```bash
STAGING_GATEWAY_URL=https://gateway.<isolated-staging-domain>
STAGING_KEYCLOAK_URL=https://auth.<isolated-staging-domain>
STAGING_PERMIFY_URL=https://permify.<isolated-staging-domain>
STAGING_TEMPORAL_HEALTH_URL=https://temporal.<isolated-staging-domain>
STAGING_DAPR_HEALTH_URL=https://dapr-gateway.<isolated-staging-domain>
STAGING_TEST_USERNAME=<dedicated-low-privilege-user>
STAGING_TEST_PASSWORD=<secret-manager-value>
```

A blank `STAGING_GATEWAY_URL` is correct until a real gateway exists; it forces the smoke suite to fail at preflight rather than test an invented target. For test-only loopback validation, use the separate local mock harness described in `LOCAL_SMOKE_HARNESS_GUIDE.md`; it is not a staging substitute.

## 6. Cleanup

```bash
kind delete cluster --name nexcom-local-staging
rm -rf .local
rm -f .env.staging
```

For minikube:

```bash
minikube delete --profile=nexcom-local-staging
```

## References

[1]: https://kind.sigs.k8s.io/docs/user/quick-start/ "kind Quick Start"
[2]: https://minikube.sigs.k8s.io/docs/drivers/docker/ "minikube Docker driver"
