.PHONY: dev dev-down deploy-k8s test lint clean help

# ============================================================================
# NEXCOM Exchange - Build & Deployment
# ============================================================================

DOCKER_COMPOSE = docker compose
KUBECTL = kubectl
HELM = helm
NAMESPACE = nexcom

# ----------------------------------------------------------------------------
# Development
# ----------------------------------------------------------------------------

dev: ## Start local development environment
	$(DOCKER_COMPOSE) -f docker-compose.yml up -d
	@echo "NEXCOM Exchange development environment started"
	@echo "  APISIX Gateway: http://localhost:9080"
	@echo "  APISIX Dashboard: http://localhost:9090"
	@echo "  Keycloak: http://localhost:8080"
	@echo "  Temporal UI: http://localhost:8233"
	@echo "  OpenSearch Dashboards: http://localhost:5601"
	@echo "  Kafka UI: http://localhost:8082"
	@echo "  Redis Insight: http://localhost:8001"

dev-down: ## Stop local development environment
	$(DOCKER_COMPOSE) -f docker-compose.yml down -v

dev-logs: ## View development logs
	$(DOCKER_COMPOSE) -f docker-compose.yml logs -f

# ----------------------------------------------------------------------------
# Kubernetes Deployment
# ----------------------------------------------------------------------------

deploy-k8s: k8s-namespaces k8s-infra k8s-security k8s-services ## Deploy everything to Kubernetes
	@echo "NEXCOM Exchange deployed to Kubernetes"

k8s-namespaces: ## Create Kubernetes namespaces
	$(KUBECTL) apply -f infrastructure/kubernetes/namespaces/

k8s-infra: ## Deploy infrastructure components
	$(HELM) upgrade --install kafka bitnami/kafka -n $(NAMESPACE)-infra -f infrastructure/kafka/values.yaml
	$(HELM) upgrade --install redis bitnami/redis-cluster -n $(NAMESPACE)-infra -f infrastructure/redis/values.yaml
	$(HELM) upgrade --install postgres bitnami/postgresql-ha -n $(NAMESPACE)-infra -f infrastructure/postgres/values.yaml
	$(HELM) upgrade --install opensearch opensearch/opensearch -n $(NAMESPACE)-infra -f infrastructure/opensearch/values.yaml
	$(KUBECTL) apply -f infrastructure/tigerbeetle/
	$(KUBECTL) apply -f infrastructure/temporal/
	$(KUBECTL) apply -f infrastructure/apisix/
	$(KUBECTL) apply -f infrastructure/dapr/
	$(KUBECTL) apply -f infrastructure/fluvio/
	$(KUBECTL) apply -f infrastructure/mojaloop/

k8s-security: ## Deploy security components
	$(HELM) upgrade --install keycloak bitnami/keycloak -n $(NAMESPACE)-security -f security/keycloak/values.yaml
	$(KUBECTL) apply -f security/openappsec/
	$(KUBECTL) apply -f security/wazuh/
	$(KUBECTL) apply -f security/opencti/

k8s-services: ## Deploy application services
	$(KUBECTL) apply -f services/trading-engine/k8s/
	$(KUBECTL) apply -f services/market-data/k8s/
	$(KUBECTL) apply -f services/risk-management/k8s/
	$(KUBECTL) apply -f services/settlement/k8s/
	$(KUBECTL) apply -f services/user-management/k8s/
	$(KUBECTL) apply -f services/notification/k8s/
	$(KUBECTL) apply -f services/ai-ml/k8s/
	$(KUBECTL) apply -f services/blockchain/k8s/

k8s-monitoring: ## Deploy monitoring stack
	$(KUBECTL) apply -f monitoring/opensearch-dashboards/
	$(KUBECTL) apply -f monitoring/kubecost/
	$(KUBECTL) apply -f monitoring/alerts/

k8s-data-platform: ## Deploy data platform (Lakehouse)
	$(KUBECTL) apply -f data-platform/lakehouse/
	$(KUBECTL) apply -f data-platform/flink-jobs/
	$(KUBECTL) apply -f data-platform/spark-jobs/
	$(KUBECTL) apply -f data-platform/datafusion/
	$(KUBECTL) apply -f data-platform/ray/
	$(KUBECTL) apply -f data-platform/sedona/

# ----------------------------------------------------------------------------
# Build
# ----------------------------------------------------------------------------

build-trading-engine: ## Build trading engine
	cd services/trading-engine && go build -o bin/trading-engine ./cmd/...

build-market-data: ## Build market data service
	cd services/market-data && go build -o bin/market-data ./cmd/...

build-risk-management: ## Build risk management service
	cd services/risk-management && go build -o bin/risk-management ./cmd/...

build-settlement: ## Build settlement service
	cd services/settlement && cargo build --release

build-blockchain: ## Build blockchain service
	cd services/blockchain && cargo build --release

build-all: build-trading-engine build-market-data build-risk-management build-settlement build-blockchain ## Build all services

# ----------------------------------------------------------------------------
# Docker
# ----------------------------------------------------------------------------

docker-build: ## Build all Docker images
	docker build -t nexcom/trading-engine:latest services/trading-engine/
	docker build -t nexcom/market-data:latest services/market-data/
	docker build -t nexcom/risk-management:latest services/risk-management/
	docker build -t nexcom/settlement:latest services/settlement/
	docker build -t nexcom/user-management:latest services/user-management/
	docker build -t nexcom/notification:latest services/notification/
	docker build -t nexcom/ai-ml:latest services/ai-ml/
	docker build -t nexcom/blockchain:latest services/blockchain/

# ----------------------------------------------------------------------------
# Testing
# ----------------------------------------------------------------------------

test: test-go test-rust test-node test-python ## Run all tests

test-go: ## Run Go tests
	cd services/trading-engine && go test ./...
	cd services/market-data && go test ./...
	cd services/risk-management && go test ./...

test-rust: ## Run Rust tests
	cd services/settlement && cargo test
	cd services/blockchain && cargo test

test-node: ## Run Node.js tests
	cd services/user-management && npm test
	cd services/notification && npm test

test-python: ## Run Python tests
	cd services/ai-ml && python -m pytest

# ----------------------------------------------------------------------------
# Linting
# ----------------------------------------------------------------------------

lint: lint-go lint-rust lint-node lint-python lint-yaml ## Run all linters

lint-go: ## Lint Go code
	cd services/trading-engine && golangci-lint run
	cd services/market-data && golangci-lint run
	cd services/risk-management && golangci-lint run

lint-rust: ## Lint Rust code
	cd services/settlement && cargo clippy
	cd services/blockchain && cargo clippy

lint-node: ## Lint Node.js code
	cd services/user-management && npm run lint
	cd services/notification && npm run lint

lint-python: ## Lint Python code
	cd services/ai-ml && ruff check .

lint-yaml: ## Lint YAML files
	yamllint infrastructure/ security/ monitoring/

# ----------------------------------------------------------------------------
# Clean
# ----------------------------------------------------------------------------

clean: ## Clean build artifacts
	rm -rf services/trading-engine/bin
	rm -rf services/market-data/bin
	rm -rf services/risk-management/bin
	cd services/settlement && cargo clean
	cd services/blockchain && cargo clean

# ----------------------------------------------------------------------------
# Help
# ----------------------------------------------------------------------------

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
