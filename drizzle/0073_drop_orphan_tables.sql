-- Migration: 0073_drop_orphan_tables (renumbered from 0067_drop_orphan_tables during integration merge)
-- Drops 13 tables that were created but NEVER written or read by any code path
-- (verified by full-repo grep across server/, services/, gateway-service/).
-- Orphan tables are liability surface: they imply features that do not exist.
--
-- Justification per table:
--   keycloak_user_sync       — Keycloak sync is handled by the IdM webhook/API
--                              layer; no sync writer ever existed.
--   dapr_pubsub_log          — Dapr publish client (server/dapr/daprClient.ts)
--                              never logged here; superseded by Kafka/Fluvio paths.
--   apisix_route_snapshots   — APISIX routes are managed declaratively; no
--                              snapshotting code existed.
--   permify_policy_log       — Permify is queried via its own API; policy
--                              changes belong in Permify's store, not Postgres.
--   opensearch_index_log     — OpenSearch indexing is tracked by OpenSearch
--                              itself; no indexer wrote here.
--   redis_cache_log          — Redis cache operations are ephemeral by design;
--                              logging every op to Postgres is an anti-pattern.
--   ledger_jobs              — No job runner ever consumed this queue table.
--   loan_ledger_entries      — TigerBeetle is the canonical double-entry ledger;
--   margin_ledger_entries      these six per-domain shadow ledgers were never
--   receipt_ledger_entries     written nor read. cross_border_ledger_entries is
--   broker_ledger_entries      RETAINED (actively used by crossBorderFxRouter).
--   clearing_ledger_entries
--   settlement_ledger_entries
--
-- NOT dropped (wired to real writers in this change):
--   tb_transfer_log   — now written by settlement ledger ops
--                       (server/tbTransferLog.ts, called from gatewayClient
--                       issueRefund and matchingEngineClient createLedgerTransfer)
--   fluvio_event_log  — now written by server/fluvio/fluvioClient.ts produce()

DROP TABLE IF EXISTS keycloak_user_sync;
DROP TABLE IF EXISTS dapr_pubsub_log;
DROP TABLE IF EXISTS apisix_route_snapshots;
DROP TABLE IF EXISTS permify_policy_log;
DROP TABLE IF EXISTS opensearch_index_log;
DROP TABLE IF EXISTS redis_cache_log;
DROP TABLE IF EXISTS ledger_jobs;
DROP TABLE IF EXISTS loan_ledger_entries;
DROP TABLE IF EXISTS margin_ledger_entries;
DROP TABLE IF EXISTS receipt_ledger_entries;
DROP TABLE IF EXISTS broker_ledger_entries;
DROP TABLE IF EXISTS clearing_ledger_entries;
DROP TABLE IF EXISTS settlement_ledger_entries;
