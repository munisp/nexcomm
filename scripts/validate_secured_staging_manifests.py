#!/usr/bin/env python3
"""Static completeness validation for secured staging deployment assets."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULT = ROOT / "test-results" / "secured_staging_manifest_validation.json"

CHECKS = {
    "compose_has_keycloak_service": ("docker-compose.yml", "  keycloak:\n"),
    "compose_keycloak_realm_mount": ("docker-compose.yml", "./infra/keycloak/nexcom-realm.json:/opt/keycloak/data/import/nexcom-realm.json:ro"),
    "compose_keycloak_schema_mount": ("docker-compose.yml", "./infra/postgres/init/00-keycloak-schema.sql:/docker-entrypoint-initdb.d/00-keycloak-schema.sql:ro"),
    "compose_keycloak_schema_script": ("infra/postgres/init/00-keycloak-schema.sql", "CREATE SCHEMA IF NOT EXISTS keycloak"),
    "compose_gateway_keycloak": ("docker-compose.yml", "KEYCLOAK_URL:"),
    "compose_gateway_permify": ("docker-compose.yml", "PERMIFY_ENDPOINT:"),
    "compose_gateway_temporal": ("docker-compose.yml", "TEMPORAL_HOST:"),
    "compose_gateway_dapr": ("docker-compose.yml", "  gateway-dapr:\n"),
    "compose_shared_dapr_mount": ("docker-compose.yml", "./infra/dapr/components:/components:ro"),
    "keycloak_optimized_image": ("infra/keycloak/Dockerfile", "kc.sh build --health-enabled=true --metrics-enabled=true --db=postgres"),
    "helm_staging_keycloak": ("infra/helm/nexcom/values-staging.yaml", "keycloak:"),
    "helm_staging_permify": ("infra/helm/nexcom/values-staging.yaml", "permify:"),
    "helm_staging_temporal": ("infra/helm/nexcom/values-staging.yaml", "temporal:"),
    "helm_staging_dapr": ("infra/helm/nexcom/values-staging.yaml", "dapr:"),
    "helm_keycloak_env": ("infra/helm/nexcom/templates/deployments.yaml", "- name: KEYCLOAK_URL"),
    "helm_permify_env": ("infra/helm/nexcom/templates/deployments.yaml", "- name: PERMIFY_ENDPOINT"),
    "helm_temporal_env": ("infra/helm/nexcom/templates/deployments.yaml", "- name: TEMPORAL_HOST"),
    "helm_dapr_annotations": ("infra/helm/nexcom/templates/deployments.yaml", "dapr.io/config:"),
    "helm_dapr_components": ("infra/helm/nexcom/templates/dapr-components.yaml", "kind: Component"),
    "compose_dapr_config": ("infra/dapr/components/config.yaml", "kind: Configuration"),
    "compose_dapr_state": ("infra/dapr/components/statestore.yaml", "type: state.redis"),
    "compose_dapr_pubsub": ("infra/dapr/components/pubsub.yaml", "type: pubsub.kafka"),
}


def main() -> int:
    checks = []
    for name, (relative, expected) in CHECKS.items():
        path = ROOT / relative
        present = path.is_file() and expected in path.read_text(encoding="utf-8")
        checks.append({"name": name, "status": "PASS" if present else "FAIL", "path": relative})

    unresolved = []
    for relative in ("infra/dapr/components/pubsub.yaml", "infra/dapr/components/statestore.yaml"):
        text = (ROOT / relative).read_text(encoding="utf-8")
        if "${" in text:
            unresolved.append(relative)
    checks.append({
        "name": "compose_dapr_components_no_unresolved_placeholders",
        "status": "PASS" if not unresolved else "FAIL",
        "path": ", ".join(unresolved) if unresolved else "infra/dapr/components",
    })

    summary = {
        "checks": checks,
        "passed": sum(item["status"] == "PASS" for item in checks),
        "failed": sum(item["status"] == "FAIL" for item in checks),
    }
    RESULT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
