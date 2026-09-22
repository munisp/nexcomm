# NEXCOM Exchange — Disaster Recovery Runbook

Scope: Postgres (primary state), TigerBeetle (ledger), lakehouse volume, Kafka
(redelivery via retention), Redis (ephemeral — no backup required).

RPO target: 24h (daily dumps) — tighten by lowering the backup interval.
RTO target: < 2h for the Postgres-backed services.

---

## 1. What is backed up and where

| Asset | Script | Output | Retention |
|---|---|---|---|
| Postgres `nexcom` DB | `scripts/backup/postgres-backup.sh` | `/backups/postgres/nexcom_<ts>.dump` (pg_dump custom) | `BACKUP_RETENTION_DAYS` (14d) |
| Lakehouse files (Delta/Parquet, `lakehouse_data` volume) | `scripts/backup/lakehouse-backup.sh` | `/backups/lakehouse/lakehouse_<ts>.tar.gz` | 14d |
| Nessie catalog | inside Postgres backup (catalog tables live in PG) | — | — |
| TigerBeetle `.tigerbeetle` file | volume snapshot (see §5) | manual/infra-level | — |
| Keycloak realm/config | Postgres backup (Keycloak DB lives in the same PG instance) + `security/keycloak/realm/*.json` in git | — | — |

Backups land on the `backup_data` compose volume. **Mirror `backup_data` off-box**
(S3/rsync) — the volume alone is not DR.

## 2. Scheduling

`docker compose --profile backup up -d backup` runs a daily dump loop inside the
stack (see the `backup` service in docker-compose.yml). For cron instead:

```cron
0 2 * * *  PGHOST=localhost PGPASSWORD=... /opt/nexcom/scripts/backup/postgres-backup.sh >> /var/log/nexcom-backup.log 2>&1
30 2 * * * LAKEHOUSE_PATH=/var/lib/docker/volumes/nexcomm_lakehouse_data/_data /opt/nexcom/scripts/backup/lakehouse-backup.sh
```

## 3. Verifying backups (do this weekly)

```bash
PGPASSWORD=... scripts/backup/restore-verify.sh /backups/postgres/latest.dump
```

Restores into a throwaway database (`nexcom_restore_verify_*`), asserts a sane
table count and critical-table row counts, then drops it. A backup that has
never been restore-tested is not a backup.

## 4. Postgres restore (real incident)

```bash
# 1. Stop writers
docker compose stop portal settlement-engine middleware-hub journey-orchestrator worker temporal-worker

# 2. Recreate the database
docker compose exec postgres psql -U nexcom -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='nexcom';"
docker compose exec postgres dropdb -U nexcom nexcom
docker compose exec postgres createdb -U nexcom nexcom

# 3. Restore the latest verified dump
docker compose exec postgres pg_restore --no-owner --no-privileges \
  -U nexcom -d nexcom /backups/postgres/latest.dump

# 4. Re-run migrations to catch up to HEAD (idempotent runner)
DATABASE_URL=postgresql://nexcom:$POSTGRES_PASSWORD@localhost:5432/nexcom node scripts/run-migrations.mjs

# 5. Restart services
docker compose start portal settlement-engine middleware-hub journey-orchestrator worker temporal-worker
```

## 5. TigerBeetle recovery

TigerBeetle state is the `tigerbeetle_data` volume (`/data/0_0.tigerbeetle`).
TB is replicated ledger state; on corruption restore the volume snapshot and
replay settlement events from Kafka (`settlement-events`, 7-day retention) via
the settlement workflow compensations. All ledger mutations flow through the
gateway ledger API (`/api/v1/ledger/*`) — never write to TB's port directly.

## 6. Lakehouse restore

```bash
tar -xzf /backups/lakehouse/latest.tar.gz -C /var/lib/docker/volumes/nexcomm_lakehouse_data/_data
# then restart lakehouse consumers: analytics-engine, datafusion, ai-ml
```

## 7. Redis / Kafka

Redis is cache + rate-limit state: no restore, just restart (sessions are
Keycloak-backed). Kafka topics are recreated by the topic-init jobs; events are
recoverable upstream (Mojaloop callbacks, settlement workflows) within the
7-day retention window.

## 8. Failure contacts & drills

- DR drill quarterly: full §4 + §6 restore into a staging compose project.
- Verify `backup_data` off-box mirror daily (`ls -lt` newest dump age < 25h).
