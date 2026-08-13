# Live Isolated-Staging Assurance Graduation Guide

**Author:** Manus AI
**Decision rule:** The platform remains **not releaseable** until this guide’s live gates execute successfully against an isolated, non-production Kubernetes cluster with real dependencies, real signed images, non-production credentials, and preserved evidence.

> A local Helm render or a loopback contract server validates wiring only. It cannot establish the durability, authorization, consistency, or interoperability of the live dependency topology.

## 1. Graduation Checklist

The automated gate is `scripts/verify-live-staging-prerequisites.sh`. It is intentionally fail-closed: any absent tool, blank/placeholder variable, missing Secret key, unauthenticated dependency, mutable image, policy failure, unavailable health endpoint, or unexecuted smoke test produces a nonzero exit status. Populate `infra/staging/live-assurance.env.template` in an untracked file and run it from a restricted CI runner or operator host.

| Gate | Required evidence | Pass condition |
|---|---|---|
| Isolated target | A dedicated Kubernetes context and namespaces separate from production. | The active context equals `STAGING_CONTEXT` and its name is not production-like. |
| Image provenance | All 29 platform images are immutable and signed. | Deployment images end in a 64-hex `@sha256` digest and each verifies against the GitHub Actions Cosign identity. |
| Secret contract | A Secret is populated only from the approved secret manager. | Required key names exist without logging values; projected files include `PERMIFY_AUTH_TOKEN`. |
| Least privilege | The staging deployer and smoke observer identities are restricted to the namespace. | Deployer can patch Deployments but cannot read Secrets; observer can read Pods but cannot execute into Pods. |
| Keycloak | Real clustered OIDC identity service with a public issuer and private administration. | Two ready replicas, expected discovery issuer, realm/client/test user, and a low-privilege token work. |
| Permify | Real PostgreSQL-backed policy service with API authentication and versioned policy state. | Two ready replicas; authenticated health; committed schema; real allow and deny permission checks. |
| TigerBeetle | Real isolated ledger cluster with persistent storage and a unique cluster ID. | Expected replica/PVC count is ready; address ordering and data-file format match the fixed cluster configuration. |
| Integration fabric | Dapr/Temporal and edge routing are real and healthy. | TLS gateway, Dapr health, Temporal health, and dependency network policy are verified. |
| Smoke evidence | The normal secured staging smoke harness runs after prerequisites pass. | `EXECUTE_LIVE_SMOKE=1` runs `secured_staging_e2e.py` against real HTTPS endpoints and returns zero failures. |
| Observability and recovery | Logs, metrics, alerts, backups, and a controlled recovery drill are captured. | Correlated rollout and smoke logs plus dependency backup/restore and failure-injection evidence exist. |

Run the gate only after inspecting the populated environment file locally. It does not create, alter, or seed dependencies.

```bash
cd /path/to/nexcomm
cp infra/staging/live-assurance.env.template .live-assurance.env
chmod 600 .live-assurance.env
# Populate non-secret endpoint metadata; keep credentials in restricted files.
set -a
. ./.live-assurance.env
set +a
./scripts/verify-live-staging-prerequisites.sh
```

The process must stop on any `FAIL` line. A clean local prerequisite report is not sufficient; retain the raw JSONL report, deployment health, image-signature output, smoke result, and correlated logs as the immutable evidence set for the exact deployed revision.

## 2. Target Architecture

The isolated staging cluster should use discrete namespaces and deny-by-default network policies. The names below are deployment boundaries, not a requirement to expose these services publicly.

| Namespace | Workload boundary | Required connectivity |
|---|---|---|
| `nexcom-staging` | Gateway, portal, workers, Dapr sidecars, APISIX routes, smoke identities. | Egress only to required dependency Services and observability collectors. |
| `nexcom-iam` | Keycloak plus its dedicated PostgreSQL database/schema. | Public login/discovery only through APISIX; internal admin path limited to operators/job runners. |
| `nexcom-authz` or existing `nexcom-infra` | Permify and its dedicated PostgreSQL database/schema. | Internal mTLS/TLS traffic only from authorized application workloads and schema bootstrap Job. |
| `nexcom-ledger` or existing `nexcom-infra` | TigerBeetle StatefulSet and dedicated persistent disks. | TCP 3001 only from configured clients and peer replicas. No public ingress. |
| `monitoring` | Prometheus, Wazuh forwarder/agent, dashboards, and alerting. | Read-only metrics/log collection according to network policy. |

APISIX remains the public edge. Open-appsec protects public routes, and OPA/Gatekeeper rejects unsigned/mutable images and workloads that violate the platform’s Pod-security and RBAC policy. Wazuh should receive Kubernetes audit and workload security events; Kubecost should monitor staging resource spend; OpenCTI is a threat-intelligence enrichment integration and must not sit in an inline authorization or funds-flow path.

## 3. Keycloak Staging Architecture and Configuration

The repository currently describes two Keycloak replicas, external PostgreSQL, Kubernetes cache discovery, a strict public hostname, separate administration hostname, and a ClusterIP service. Retain those boundaries, but replace all production hostnames with staging-only DNS and do not inject the admin password by `helm --set` because command-line values can leak into process history and CI logs.

### 3.1 Durable Identity Store and Secrets

Create a dedicated PostgreSQL database and role for Keycloak. Restrict that role to its own database/schema, require TLS to PostgreSQL where supported, and back up/restore-test the database before dependency validation. Put the Keycloak database password, bootstrap admin credential, gateway client secret, and admin-service client secret in the approved secret manager and synchronize only the necessary keys to a namespace-local Kubernetes Secret.

```text
Database: keycloak_staging
Role: keycloak_staging
Secret: nexcom-keycloak-db-secret
Keys: password
```

The realm-import ConfigMap must contain only non-secret realm/client configuration. Do not place user passwords, private keys, token signing material, or production identities in the import file. Provision the dedicated smoke user after realm import through the restricted admin client, assign only the minimum smoke role, and deny every settlement, ledger, management, and broad administrative permission.

### 3.2 Edge and Hostname Controls

Use separate staging names, for example `auth.staging.<approved-domain>` for the public issuer and `auth-admin.staging.<approved-domain>` for the administrative interface. Keycloak’s production documentation recommends secure communication, a reverse proxy/load balancer, a production-grade database, and multiple instances for clustered availability. [1] Its reverse-proxy guidance recommends restricting backend network access to the proxy, overwriting forwarded headers, and keeping management port 9000 and health/metrics off public proxy routes. [2]

For TLS re-encryption, configure Keycloak with `proxy-headers` matching the edge’s exact header format and set trusted proxy address ranges. The edge must overwrite `Forwarded` and `X-Forwarded-*` headers; do not merely append them. Expose `/realms/`, `/.well-known/`, and required static resources. Keep `/admin/`, `/realms/master/`, `/metrics`, and `/health` private. The Keycloak management health port is not an internet endpoint.

### 3.3 Readiness and Validation

Enable health and metrics during the Keycloak build. The documented readiness endpoint is `/health/ready`; Keycloak reports 200 only when it is ready for traffic and its health endpoints are on management port 9000 by default. [3] Configure startup, liveness, and readiness probes against the internal management service, not through public ingress.

The staging gate must verify all of the following:

| Check | Expected result |
|---|---|
| Two replicas | At least two ready replicas across distinct nodes/failure domains. |
| Database migration/init | Readiness remains down until Keycloak initialization completes. |
| Public discovery | `/.well-known/openid-configuration` returns the exact configured staging issuer and token endpoint. |
| Admin isolation | Public gateway cannot reach admin/management paths; restricted operator path can. |
| Token test | Low-privilege smoke user obtains a token with the expected staging issuer/audience. |
| Negative test | Smoke user cannot access Keycloak admin APIs, ledger, settlement, or protected administrative gateway routes. |

## 4. Permify Staging Architecture and Configuration

Permify is the authorization system of record for the deployed schema and relationship tuples. Its APIs distinguish tenant, schema, relationship/attribute data, and permission checks. [4] Store policy state in a dedicated PostgreSQL database, not a memory engine; use separate DB credentials and migration ownership from the application database. Permify supports PostgreSQL, TLS for HTTP/gRPC, and either OIDC or preshared-key API authentication. [5]

### 4.1 Secure Service Contract

Deploy at least two Permify replicas behind an internal ClusterIP Service. Enable API authentication. The recommended approach is OIDC validation against the staging Keycloak issuer with a tightly scoped audience; use a dedicated preshared service token only if the OIDC path cannot be validated. In both cases, deliver the credential through `PERMIFY_AUTH_TOKEN_FILE` from a read-only projected Secret file. The gateway has been remediated to use `NewAuthenticatedClient`, read this mounted token, include `Authorization: Bearer …` on every permission and relationship request, and use `PERMIFY_TENANT_ID` rather than a hard-coded tenant.

No public Permify ingress is required. Apply network policy that permits only the application service accounts and the schema-bootstrap Job to reach Permify, plus database egress to its dedicated PostgreSQL instance. Do not route Permify health or check endpoints through public APISIX paths.

### 4.2 Schema and Relationship Bootstrap

The schema bootstrap container now fails on unavailable health, non-HTTPS transport outside explicit local test mode, absent API authentication in staging/production, malformed schema response, or any non-200/201 schema-write response. It no longer logs a warning and exits successfully after a failed schema push.

Use this sequence exactly:

1. Build the bootstrap image from the reviewed `permify.perm` revision.
2. Create or select a non-production tenant, for example `nexcom-staging`.
3. Write the schema through `infra/permify/push-schema.sh` using `PERMIFY_AUTH_TOKEN_FILE`, a staging CA bundle when private PKI is used, and HTTPS.
4. Capture the schema version from Permify’s response and associate it with the Git revision and deployment evidence.
5. Seed only designated smoke relationships through an authenticated, audited job. Each relationship must use non-production user and resource IDs.
6. Run one known-allowed and one known-denied Permission Check request against the exact schema and tuple set. The verifier uses `PERMIFY_ALLOW_CHECK_BODY_FILE` and `PERMIFY_DENY_CHECK_BODY_FILE` and expects `CHECK_RESULT_ALLOWED` and `CHECK_RESULT_DENIED` respectively.
7. Delete or isolate the smoke tuples after execution if the environment is reused.

The allow and deny payload files are mandatory assurance artifacts; they must identify the intended tenant, resource, subject, action, and schema/snap-token metadata without embedding credentials. A 200 response alone is insufficient.

## 5. TigerBeetle Staging Architecture and Configuration

TigerBeetle is the accounting system of record for the exchange ledger and must not use a process-local fallback. Each replica owns one data file, and every data file must be formatted before the server starts with the same globally unique nonzero cluster ID, the same fixed replica count, and a distinct replica index. All clients and replicas must use the same ordered address list. [6]

### 5.1 Isolated Staging Topology

For functional isolated staging, use three replicas only if the environment is explicitly labeled as a reduced-resilience validation topology. Pin each replica to a separate node and a separate encrypted `ReadWriteOnce` persistent volume. Use a headless Service and canonical addresses in ordinal order:

```text
tigerbeetle-0.tigerbeetle-headless.nexcom-ledger.svc.cluster.local:3001,
tigerbeetle-1.tigerbeetle-headless.nexcom-ledger.svc.cluster.local:3001,
tigerbeetle-2.tigerbeetle-headless.nexcom-ledger.svc.cluster.local:3001
```

Set `TIGERBEETLE_CLUSTER_ID` to a randomly generated nonzero 128-bit value and persist it in restricted deployment metadata. Never use cluster ID `0`, which the deployment documentation reserves for testing. Do not change the replica count after formatting; TigerBeetle documents that it is fixed for the current cluster configuration. [6]

For mission-critical production-like resilience, use six replicas across three failure domains with independent disks and machines. TigerBeetle’s cluster guidance identifies six replicas as the recommended production topology and explains that it is designed to become unavailable rather than risk incorrect behavior when safe operation cannot be preserved. [7]

### 5.2 Safe Format and Startup Sequence

1. Provision a distinct PVC for each ordinal and verify encryption, IOPS, snapshot policy, and independent failure domain.
2. Before the StatefulSet runs its normal server command, run a one-time restricted formatting Job per PVC. It must invoke `tigerbeetle format --cluster=<nonzero-id> --replica-count=<count> --replica=<ordinal> /data/<cluster-id>_<ordinal>.tigerbeetle`.
3. Record the exact cluster ID, replica count, binary image digest, ordered address list, and PVC names in the staging evidence store.
4. Start each replica with the identical ordered `--addresses=` value and its own formatted data file path. Reject startup if formatting metadata does not match.
5. Expose TCP 3001 only internally to configured client workloads and peer replicas. Do not create public ingress or an unauthenticated HTTP proxy.
6. Run real non-production account and transfer operations using the actual gateway/ledger client, verify idempotency behavior with a repeated transfer ID, and perform a controlled single-replica disruption while observing valid recovery. Do not create balances or transfer confirmations with a test double.

## 6. Completion Evidence and Remaining Release Blockers

The verifier is a graduation prerequisite, not final assurance by itself. The assurance review remains blocked until all following artifacts exist for one immutable deployed revision: signed digest manifest, Helm values, Kubernetes rollout health, Keycloak realm/client/test-user evidence, Permify schema version and allow/deny result, TigerBeetle cluster/PVC and real operation evidence, live secured smoke result, dependency fault/recovery evidence, and correlated application/APISIX/open-appsec/Wazuh logs.

The current sandbox still lacks an authorized live cluster, real signed image registry, populated Secret material, and real dependency endpoints. Consequently, run the guide and verifier in the designated isolated staging environment, preserve their raw output, and return the artifacts for the final assurance decision. Until then the correct status is **BLOCKED — NOT RELEASEABLE**.

## References

[1]: https://www.keycloak.org/server/configuration-production "Keycloak: Configuring Keycloak for production"
[2]: https://www.keycloak.org/server/reverseproxy "Keycloak: Configuring a reverse proxy"
[3]: https://www.keycloak.org/observability/health "Keycloak: Tracking instance status with health checks"
[4]: https://docs.permify.co/getting-started/enforcement "Permify: Interacting With The API"
[5]: https://docs.permify.co/setting-up/configuration "Permify: Configuration"
[6]: https://docs.tigerbeetle.com/operating/deploying/ "TigerBeetle: Deploying"
[7]: https://docs.tigerbeetle.com/operating/cluster/ "TigerBeetle: Cluster Recommendations"
