# Synthetic Assurance Seed Data

`scripts/seed-assurance-data.mjs` creates deterministic, clearly labelled **synthetic test data** for isolated local development, CI, and non-production integration environments. The default mode is a dry run that writes `assurance-seed-plan.json` and does not connect to a database. The apply mode requires an explicit acknowledgement, rejects `NODE_ENV=production`, and permits only `localhost`, `127.0.0.1`, or `::1` database hosts.

> This generator is deliberately prohibited from production. It never creates real customers, credentials, payment instruments, KYC documents, provider tokens, or live external-provider records. The `.invalid` email domain, `TST-` identifiers, and `synthetic: true` metadata ensure that the records can be identified and removed from a test environment.

## Usage

```bash
# Safe by default: writes a deterministic plan and makes no database connection.
pnpm run seed:assurance

# Explicit local test database apply. The command refuses production and non-local hosts.
DATABASE_URL='postgresql://nexcom:test_password@127.0.0.1:5432/nexcom_test' \
NODE_ENV=test \
ALLOW_TEST_SEED=I_UNDERSTAND_THIS_IS_NON_PRODUCTION \
node scripts/seed-assurance-data.mjs --apply
```

| Domain | Synthetic records created when the corresponding table exists |
|---|---|
| Identity and role coverage | Six users spanning farmer, trader, broker, warehouse operator, administrator, and a second farmer; profiles; KYC review state. |
| Reference market and storage | Three tradeable instruments, two accredited warehouses, watchlists, and price alerts. |
| Physical operations | Warehouse receipts in active/pledged/redeemed states, deposit requests in received/pending states, and a scheduled delivery. |
| Trading and settlement | Filled, partially filled, open, and cancelled orders; settlements; notifications; ten portfolio snapshots. |
| Banking and ledger | Savings, settlement, and current accounts; payload-identified bank transactions; two shadow-ledger transfer records; two canonical ledger accounts; a balanced two-entry journal. |
| Audit and workflow | Five seed lifecycle audit events and three completed synthetic workflow executions. |

## Data integrity and test usage

All time, user, instrument, warehouse, account, order, transfer, journal, workflow, and audit identifiers are stable. Re-running the script uses unique `TST-` identifiers and conflict-aware inserts so the test state is repeatable. The script checks whether each target table exists and records skipped groups rather than trying to manufacture a schema. The resulting plan is stored in `assurance/seed-data/assurance-seed-plan.json` and records the execution mode, inserted/reused/skipped groups, and target host.

The seed generator creates representative records for integration paths; it does not itself prove ledger correctness, provider settlement, access control, financial calculation accuracy, or production readiness. The assurance prompt and CI release gate still require the appropriate real-dependency integration, E2E, reconciliation, authorization, recovery, and audit tests.
