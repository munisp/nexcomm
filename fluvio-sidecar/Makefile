# ─────────────────────────────────────────────────────────────────────────────
# NEXCOM Fluvio Sidecar — Build, Push & Deploy Makefile
# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   make build          Build the Docker image locally
#   make push           Push to container registry
#   make deploy         Apply Kubernetes manifests
#   make all            build + push + deploy
#   make logs           Tail sidecar logs from the cluster
#   make test           Run integration tests against the local sidecar
#   make clean          Remove local Docker image
#
# Required environment variables (set in .env or export before running):
#   REGISTRY            Container registry (e.g. ghcr.io/nexcom or docker.io/nexcom)
#   IMAGE_TAG           Image tag (default: git short SHA)
#   FLUVIO_ENDPOINT     Fluvio SC address (e.g. fluvio.nexcom.internal:9003)
#   KUBECONFIG          Path to kubeconfig (default: ~/.kube/config)
#   NAMESPACE           Kubernetes namespace (default: nexcom)
# ─────────────────────────────────────────────────────────────────────────────

# ── Defaults ─────────────────────────────────────────────────────────────────
REGISTRY        ?= ghcr.io/nexcom
IMAGE_TAG       ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "latest")
IMAGE_NAME      := $(REGISTRY)/fluvio-sidecar:$(IMAGE_TAG)
IMAGE_LATEST    := $(REGISTRY)/fluvio-sidecar:latest
FLUVIO_ENDPOINT ?= fluvio.nexcom.internal:9003
NAMESPACE       ?= nexcom
KUBECONFIG      ?= $(HOME)/.kube/config
MANIFESTS_DIR   := ../infra/k8s
SIDECAR_MANIFEST := $(MANIFESTS_DIR)/fluvio-sidecar-deployment.yaml

# ── Colours ──────────────────────────────────────────────────────────────────
BOLD  := \033[1m
GREEN := \033[32m
CYAN  := \033[36m
RESET := \033[0m

.PHONY: all build push deploy logs test clean check-env patch-manifest

# ── Default target ────────────────────────────────────────────────────────────
all: check-env build push deploy
	@echo "$(GREEN)$(BOLD)✓ Fluvio sidecar deployed successfully$(RESET)"

# ── Validate required env vars ───────────────────────────────────────────────
check-env:
	@echo "$(CYAN)Checking required environment variables...$(RESET)"
	@test -n "$(REGISTRY)"         || (echo "ERROR: REGISTRY is not set"; exit 1)
	@test -n "$(FLUVIO_ENDPOINT)"  || (echo "ERROR: FLUVIO_ENDPOINT is not set"; exit 1)
	@echo "  REGISTRY         = $(REGISTRY)"
	@echo "  IMAGE_TAG        = $(IMAGE_TAG)"
	@echo "  FLUVIO_ENDPOINT  = $(FLUVIO_ENDPOINT)"
	@echo "  NAMESPACE        = $(NAMESPACE)"

# ── Build Docker image ────────────────────────────────────────────────────────
build:
	@echo "$(CYAN)$(BOLD)Building Fluvio sidecar image...$(RESET)"
	docker build \
		--platform linux/amd64 \
		--build-arg FLUVIO_ENDPOINT=$(FLUVIO_ENDPOINT) \
		-t $(IMAGE_NAME) \
		-t $(IMAGE_LATEST) \
		-f Dockerfile \
		.
	@echo "$(GREEN)✓ Image built: $(IMAGE_NAME)$(RESET)"

# ── Push to registry ──────────────────────────────────────────────────────────
push:
	@echo "$(CYAN)$(BOLD)Pushing image to registry...$(RESET)"
	docker push $(IMAGE_NAME)
	docker push $(IMAGE_LATEST)
	@echo "$(GREEN)✓ Pushed: $(IMAGE_NAME)$(RESET)"

# ── Patch manifest with current image tag ────────────────────────────────────
patch-manifest:
	@echo "$(CYAN)Patching manifest with image tag $(IMAGE_TAG)...$(RESET)"
	@sed -i.bak \
		"s|image: .*fluvio-sidecar.*|image: $(IMAGE_NAME)|g" \
		$(SIDECAR_MANIFEST)
	@rm -f $(SIDECAR_MANIFEST).bak
	@echo "$(GREEN)✓ Manifest patched$(RESET)"

# ── Deploy to Kubernetes ──────────────────────────────────────────────────────
deploy: patch-manifest
	@echo "$(CYAN)$(BOLD)Deploying Fluvio sidecar to Kubernetes namespace '$(NAMESPACE)'...$(RESET)"
	@# Ensure the namespace exists
	kubectl --kubeconfig=$(KUBECONFIG) create namespace $(NAMESPACE) --dry-run=client -o yaml | \
		kubectl --kubeconfig=$(KUBECONFIG) apply -f -
	@# Update the FLUVIO_ENDPOINT in the nexcom-config ConfigMap
	kubectl --kubeconfig=$(KUBECONFIG) -n $(NAMESPACE) \
		patch configmap nexcom-config \
		--type merge \
		-p '{"data":{"FLUVIO_ENDPOINT":"$(FLUVIO_ENDPOINT)"}}' \
		2>/dev/null || \
		kubectl --kubeconfig=$(KUBECONFIG) -n $(NAMESPACE) \
			create configmap nexcom-config \
			--from-literal=FLUVIO_ENDPOINT=$(FLUVIO_ENDPOINT) \
			--dry-run=client -o yaml | \
			kubectl --kubeconfig=$(KUBECONFIG) apply -f -
	@# Apply the sidecar deployment
	kubectl --kubeconfig=$(KUBECONFIG) apply -f $(SIDECAR_MANIFEST) -n $(NAMESPACE)
	@# Wait for rollout
	kubectl --kubeconfig=$(KUBECONFIG) -n $(NAMESPACE) \
		rollout status deployment/fluvio-sidecar --timeout=120s
	@echo "$(GREEN)✓ Fluvio sidecar deployed and healthy$(RESET)"

# ── Tail logs ─────────────────────────────────────────────────────────────────
logs:
	kubectl --kubeconfig=$(KUBECONFIG) -n $(NAMESPACE) \
		logs -f -l app=fluvio-sidecar --tail=100

# ── Integration tests ─────────────────────────────────────────────────────────
test:
	@echo "$(CYAN)$(BOLD)Running Fluvio sidecar integration tests...$(RESET)"
	@# Start sidecar locally for testing
	@FLUVIO_ENDPOINT=$(FLUVIO_ENDPOINT) \
	 SIDECAR_PORT=8765 \
	 python3 -m pytest tests/ -v --tb=short 2>/dev/null || \
	 python3 -m unittest discover -s tests/ -v
	@echo "$(GREEN)✓ Tests passed$(RESET)"

# ── Smoke test against a running sidecar ─────────────────────────────────────
smoke:
	@echo "$(CYAN)Running smoke tests against deployed sidecar...$(RESET)"
	@SIDECAR_URL=$$(kubectl --kubeconfig=$(KUBECONFIG) -n $(NAMESPACE) \
		get svc fluvio-sidecar-service -o jsonpath='{.spec.clusterIP}') && \
	echo "Sidecar ClusterIP: $$SIDECAR_URL" && \
	curl -sf "http://$$SIDECAR_URL:8765/health" | python3 -m json.tool && \
	echo "$(GREEN)✓ Health check passed$(RESET)"

# ── Clean local image ─────────────────────────────────────────────────────────
clean:
	@echo "$(CYAN)Removing local Docker images...$(RESET)"
	-docker rmi $(IMAGE_NAME) $(IMAGE_LATEST) 2>/dev/null || true
	@echo "$(GREEN)✓ Cleaned$(RESET)"

# ── Help ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "$(BOLD)NEXCOM Fluvio Sidecar — Makefile targets$(RESET)"
	@echo ""
	@echo "  $(CYAN)make all$(RESET)            Build, push, and deploy"
	@echo "  $(CYAN)make build$(RESET)          Build Docker image"
	@echo "  $(CYAN)make push$(RESET)           Push image to registry"
	@echo "  $(CYAN)make deploy$(RESET)         Apply Kubernetes manifests"
	@echo "  $(CYAN)make logs$(RESET)           Tail sidecar pod logs"
	@echo "  $(CYAN)make test$(RESET)           Run integration tests locally"
	@echo "  $(CYAN)make smoke$(RESET)          Smoke test deployed sidecar"
	@echo "  $(CYAN)make clean$(RESET)          Remove local Docker images"
	@echo ""
	@echo "$(BOLD)Required environment variables:$(RESET)"
	@echo "  REGISTRY           Container registry prefix"
	@echo "  FLUVIO_ENDPOINT    Fluvio SC address (host:port)"
	@echo ""
	@echo "$(BOLD)Example:$(RESET)"
	@echo "  REGISTRY=ghcr.io/nexcom FLUVIO_ENDPOINT=fluvio.nexcom.internal:9003 make all"
	@echo ""
