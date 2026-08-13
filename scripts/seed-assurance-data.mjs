#!/usr/bin/env node
/**
 * Deterministic non-production seed generator.
 * Default mode creates an auditable plan only. --apply requires an explicit
 * acknowledgement and refuses non-local or NODE_ENV=production connections.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const output = path.resolve(process.cwd(), "assurance/seed-data/assurance-seed-plan.json");
const runId = "assurance-seed-v1";
const timestamp = "2026-01-15T09:30:00.000Z";
const databaseUrl = process.env.DATABASE_URL ?? "";
const apply = has("--apply");
const ack = process.env.ALLOW_TEST_SEED === "I_UNDERSTAND_THIS_IS_NON_PRODUCTION";

const users = [
  { key: "farmer-01", openId: "assurance-farmer-01", name: "Test Ada Nwosu", email: "ada.nwosu@testing.invalid", role: "farmer", accountType: "FARMER", state: "Kaduna" },
  { key: "farmer-02", openId: "assurance-farmer-02", name: "Test Bayo Okafor", email: "bayo.okafor@testing.invalid", role: "farmer", accountType: "FARMER", state: "Nasarawa" },
  { key: "trader-01", openId: "assurance-trader-01", name: "Test Chika Bello", email: "chika.bello@testing.invalid", role: "trader", accountType: "TRADER", state: "Lagos" },
  { key: "broker-01", openId: "assurance-broker-01", name: "Test Damilola Yusuf", email: "damilola.yusuf@testing.invalid", role: "broker", accountType: "BROKER", state: "Abuja" },
  { key: "operator-01", openId: "assurance-operator-01", name: "Test Efe Danjuma", email: "efe.danjuma@testing.invalid", role: "user", accountType: "WAREHOUSE_OPERATOR", state: "Kano" },
  { key: "admin-01", openId: "assurance-admin-01", name: "Test Governance Officer", email: "governance.officer@testing.invalid", role: "admin", accountType: "TRADER", state: "Abuja" },
];

const instruments = [
  { symbol: "TST-MAIZE-NG", name: "Test Nigerian Maize Spot", assetClass: "COMMODITY", baseCurrency: "NGN", quoteCurrency: "NGN", lotSize: "1", minLotSize: "1", tickSize: "0.01", settlementDays: 2 },
  { symbol: "TST-GINGER-NG", name: "Test Nigerian Ginger Spot", assetClass: "COMMODITY", baseCurrency: "NGN", quoteCurrency: "NGN", lotSize: "1", minLotSize: "1", tickSize: "0.01", settlementDays: 2 },
  { symbol: "TST-ABCP-NGN", name: "Test Agricultural Commercial Paper", assetClass: "FIXED_INCOME", baseCurrency: "NGN", quoteCurrency: "NGN", lotSize: "1000", minLotSize: "1000", tickSize: "0.01", settlementDays: 1 },
];

const warehouses = [
  { code: "TST-KAD-01", name: "Test Kaduna Grain Hub", state: "Kaduna", city: "Kaduna", capacityMt: "12000", availableCapacityMt: "7800", supportedCommodities: ["MAIZE", "GINGER", "SOYBEAN"] },
  { code: "TST-ABJ-01", name: "Test Abuja Commodity Depot", state: "FCT", city: "Abuja", capacityMt: "8500", availableCapacityMt: "5100", supportedCommodities: ["GINGER", "SESAME"] },
];

const plan = {
  schemaVersion: 1,
  seedRunId: runId,
  generatedAt: timestamp,
  environmentRule: "Synthetic test data only; never production customer, payment, token, credential, KYC-document, or live-provider data.",
  domains: {
    identityAndRoles: { users: users.length, profiles: users.length, kycQueue: 3 },
    marketReference: { instruments: instruments.length, warehouses: warehouses.length, watchlists: 3, priceAlerts: 4 },
    physicalOperations: { warehouseReceipts: 4, depositRequests: 2, deliveryOrders: 1 },
    tradingAndSettlement: { orders: 4, settlements: 2, notifications: 4, portfolioSnapshots: 10 },
    bankingAndLedger: { bankAccounts: 3, bankTransactions: 3, shadowLedgerTransfers: 2, ledgerAccounts: 2, balancedLedgerEntries: 2 },
    auditAndWorkflow: { auditEvents: 5, workflowExecutions: 3 },
  },
  fixtures: { users, instruments, warehouses },
  applyGuard: "Run only with --apply, ALLOW_TEST_SEED=I_UNDERSTAND_THIS_IS_NON_PRODUCTION, NODE_ENV not production, and a localhost database URL.",
};

function writePlan(result = {}) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify({ ...plan, execution: result }, null, 2)}\n`);
  console.log(`Seed plan: ${path.relative(process.cwd(), output)}`);
}

function assertSafeTarget() {
  if (!apply) return;
  if (!ack) throw new Error("Refusing to seed: set ALLOW_TEST_SEED=I_UNDERSTAND_THIS_IS_NON_PRODUCTION and use --apply.");
  if (!databaseUrl) throw new Error("Refusing to seed: DATABASE_URL is required for --apply.");
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed while NODE_ENV=production.");
  const host = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error(`Refusing non-local database host: ${host}`);
}

async function tableExists(sql, table) {
  const [{ exists }] = await sql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists`;
  return exists;
}

async function insertIfAbsent(sql, selectQuery, insertQuery, table, result) {
  if (!(await tableExists(sql, table))) { result.skipped.push(`${table}: table absent`); return null; }
  const existing = await selectQuery();
  if (existing.length > 0) { result.reused.push(table); return existing[0]; }
  const inserted = await insertQuery();
  result.inserted.push(table);
  return inserted[0] ?? null;
}

async function seedDatabase() {
  assertSafeTarget();
  const { default: postgres } = await import("postgres");
  const sql = postgres(databaseUrl, { max: 1, ssl: false, onnotice: () => {} });
  const result = { mode: "apply", inserted: [], reused: [], skipped: [], seedRunId: runId, databaseHost: new URL(databaseUrl).hostname };
  try {
    await sql.begin(async (transaction) => {
      const userIds = {};
      for (const user of users) {
        const row = await insertIfAbsent(
          transaction,
          () => transaction`SELECT id FROM users WHERE open_id = ${user.openId} LIMIT 1`,
          () => transaction`INSERT INTO users (open_id, name, email, role, created_at, updated_at, last_signed_in) VALUES (${user.openId}, ${user.name}, ${user.email}, ${user.role}, ${timestamp}, ${timestamp}, ${timestamp}) RETURNING id`,
          "users", result,
        );
        if (row) userIds[user.key] = row.id;
      }

      if (await tableExists(transaction, "profiles")) {
        for (const user of users) {
          const userId = userIds[user.key];
          if (!userId) continue;
          const [firstName, ...lastNameParts] = user.name.replace("Test ", "").split(" ");
          await transaction`INSERT INTO profiles (user_id, account_type, first_name, last_name, phone, state, country, kyc_status, stakeholder_type, metadata, created_at, updated_at)
            VALUES (${userId}, ${user.accountType}, ${firstName}, ${lastNameParts.join(" ")}, ${`+234800000${String(Object.keys(userIds).indexOf(user.key) + 1).padStart(3, "0")}`}, ${user.state}, 'Nigeria', 'VERIFIED', ${user.accountType}, ${JSON.stringify({ seedRunId: runId, synthetic: true })}::jsonb, ${timestamp}, ${timestamp})
            ON CONFLICT (user_id) DO NOTHING`;
        }
        result.inserted.push("profiles");
      } else result.skipped.push("profiles: table absent");

      if (await tableExists(transaction, "instruments")) {
        for (const instrument of instruments) {
          await transaction`INSERT INTO instruments (symbol, name, asset_class, base_currency, quote_currency, lot_size, min_lot_size, tick_size, settlement_days, status, description, created_at, updated_at)
            VALUES (${instrument.symbol}, ${instrument.name}, ${instrument.assetClass}, ${instrument.baseCurrency}, ${instrument.quoteCurrency}, ${instrument.lotSize}, ${instrument.minLotSize}, ${instrument.tickSize}, ${instrument.settlementDays}, 'ACTIVE', ${`Synthetic assurance instrument ${runId}`}, ${timestamp}, ${timestamp})
            ON CONFLICT (symbol) DO NOTHING`;
        }
        result.inserted.push("instruments");
      } else result.skipped.push("instruments: table absent");

      if (await tableExists(transaction, "warehouses")) {
        for (const warehouse of warehouses) {
          await transaction`INSERT INTO warehouses (name, code, address, city, state, country, capacity_mt, available_capacity_mt, accreditation_status, supported_commodities, is_active, created_at, updated_at)
            VALUES (${warehouse.name}, ${warehouse.code}, ${`${warehouse.city} synthetic test location`}, ${warehouse.city}, ${warehouse.state}, 'Nigeria', ${warehouse.capacityMt}, ${warehouse.availableCapacityMt}, 'ACCREDITED', ${JSON.stringify(warehouse.supportedCommodities)}::jsonb, true, ${timestamp}, ${timestamp})
            ON CONFLICT (code) DO NOTHING`;
        }
        result.inserted.push("warehouses");
      } else result.skipped.push("warehouses: table absent");

      const farmerId = userIds["farmer-01"];
      const traderId = userIds["trader-01"];
      const brokerId = userIds["broker-01"];
      const adminId = userIds["admin-01"];
      if (farmerId && await tableExists(transaction, "warehouse_receipts")) {
        const receipts = [
          ["TST-WR-001", "MAIZE", "A", "250.000000", "MT", "Test Kaduna Grain Hub", "ACTIVE", "2250000.00"],
          ["TST-WR-002", "GINGER", "G1", "75.000000", "MT", "Test Abuja Commodity Depot", "PLEDGED", "5100000.00"],
          ["TST-WR-003", "SESAME", "A", "40.000000", "MT", "Test Abuja Commodity Depot", "REDEEMED", "2720000.00"],
          ["TST-WR-004", "MAIZE", "B", "100.000000", "MT", "Test Kaduna Grain Hub", "ACTIVE", "760000.00"],
        ];
        for (const [receiptNumber, commodity, grade, quantity, unit, warehouseName, status, valueUsd] of receipts) {
          await transaction`INSERT INTO warehouse_receipts (user_id, receipt_number, commodity, grade, quantity, unit, warehouse_name, deposit_date, expiry_date, status, value_usd, notes, created_at, updated_at)
            VALUES (${farmerId}, ${receiptNumber}, ${commodity}, ${grade}, ${quantity}, ${unit}, ${warehouseName}, ${timestamp}, '2026-12-31T00:00:00.000Z', ${status}, ${valueUsd}, ${`Synthetic test receipt ${runId}`}, ${timestamp}, ${timestamp})
            ON CONFLICT (receipt_number) DO NOTHING`;
        }
        result.inserted.push("warehouse_receipts");
      } else result.skipped.push("warehouse_receipts: table absent or farmer unavailable");

      if (farmerId && await tableExists(transaction, "deposit_requests")) {
        for (const [commodity, grade, quantity, warehouseName, status] of [["MAIZE", "A", "80.000000", "Test Kaduna Grain Hub", "RECEIVED"], ["GINGER", "G1", "12.500000", "Test Abuja Commodity Depot", "PENDING"]]) {
          await transaction`INSERT INTO deposit_requests (user_id, commodity, grade, quantity, unit, warehouse_name, expected_date, status, notes, created_at, updated_at)
            SELECT ${farmerId}, ${commodity}, ${grade}, ${quantity}, 'MT', ${warehouseName}, ${timestamp}, ${status}, ${`Synthetic deposit request ${runId}`}, ${timestamp}, ${timestamp}
            WHERE NOT EXISTS (SELECT 1 FROM deposit_requests WHERE user_id = ${farmerId} AND commodity = ${commodity} AND notes = ${`Synthetic deposit request ${runId}`})`;
        }
        result.inserted.push("deposit_requests");
      } else result.skipped.push("deposit_requests: table absent or farmer unavailable");

      if (farmerId && await tableExists(transaction, "delivery_orders")) {
        const receipt = await transaction`SELECT id FROM warehouse_receipts WHERE receipt_number = 'TST-WR-003' LIMIT 1`;
        await transaction`INSERT INTO delivery_orders (user_id, receipt_id, commodity, quantity, unit, delivery_address, scheduled_date, status, notes, created_at, updated_at)
          SELECT ${farmerId}, ${receipt[0]?.id ?? null}, 'SESAME', '10.000000', 'MT', 'Synthetic test delivery destination, Abuja', ${timestamp}, 'SCHEDULED', ${`Synthetic delivery ${runId}`}, ${timestamp}, ${timestamp}
          WHERE NOT EXISTS (SELECT 1 FROM delivery_orders WHERE user_id = ${farmerId} AND notes = ${`Synthetic delivery ${runId}`})`;
        result.inserted.push("delivery_orders");
      } else result.skipped.push("delivery_orders: table absent or farmer unavailable");

      const orderRows = [];
      if (traderId && await tableExists(transaction, "orders")) {
        const orders = [
          ["TST-ORDER-001", "TST-MAIZE-NG", "BUY", "LIMIT", "100.000000", "7800.00", "FILLED", "100.000000"],
          ["TST-ORDER-002", "TST-GINGER-NG", "SELL", "LIMIT", "25.000000", "68000.00", "PARTIALLY_FILLED", "10.000000"],
          ["TST-ORDER-003", "TST-MAIZE-NG", "BUY", "MARKET", "50.000000", "7900.00", "OPEN", "0.000000"],
          ["TST-ORDER-004", "TST-ABCP-NGN", "BUY", "LIMIT", "2000.000000", "1.02", "CANCELLED", "0.000000"],
        ];
        for (const [clientOrderId, symbol, side, orderType, quantity, price, status, filledQty] of orders) {
          let row = await transaction`SELECT id, user_id, symbol, side, quantity, price FROM orders WHERE client_order_id = ${clientOrderId} LIMIT 1`;
          if (row.length === 0) row = await transaction`INSERT INTO orders (user_id, symbol, asset_class, side, order_type, quantity, price, filled_qty, avg_fill_price, status, time_in_force, client_order_id, notes, created_at, updated_at)
            VALUES (${traderId}, ${symbol}, 'COMMODITY', ${side}, ${orderType}, ${quantity}, ${price}, ${filledQty}, ${filledQty === "0.000000" ? null : price}, ${status}, 'GTC', ${clientOrderId}, ${`Synthetic test order ${runId}`}, ${timestamp}, ${timestamp})
            RETURNING id, user_id, symbol, side, quantity, price`;
          orderRows.push(row[0]);
        }
        result.inserted.push("orders");
      } else result.skipped.push("orders: table absent or trader unavailable");

      if (traderId && await tableExists(transaction, "watchlist")) {
        for (const symbol of ["TST-MAIZE-NG", "TST-GINGER-NG", "TST-ABCP-NGN"]) {
          await transaction`INSERT INTO watchlist (user_id, symbol, created_at)
            SELECT ${traderId}, ${symbol}, ${timestamp}
            WHERE NOT EXISTS (SELECT 1 FROM watchlist WHERE user_id = ${traderId} AND symbol = ${symbol})`;
        }
        result.inserted.push("watchlist");
      } else result.skipped.push("watchlist: table absent or trader unavailable");

      if (traderId && await tableExists(transaction, "price_alerts")) {
        for (const [symbol, condition, targetPrice] of [["TST-MAIZE-NG", "ABOVE", "8100.00"], ["TST-GINGER-NG", "BELOW", "65000.00"], ["TST-ABCP-NGN", "ABOVE", "1.05"], ["TST-MAIZE-NG", "BELOW", "7500.00"]]) {
          await transaction`INSERT INTO price_alerts (user_id, symbol, condition, target_price, triggered, notified, created_at)
            SELECT ${traderId}, ${symbol}, ${condition}, ${targetPrice}, false, false, ${timestamp}
            WHERE NOT EXISTS (SELECT 1 FROM price_alerts WHERE user_id = ${traderId} AND symbol = ${symbol} AND condition = ${condition} AND target_price = ${targetPrice})`;
        }
        result.inserted.push("price_alerts");
      } else result.skipped.push("price_alerts: table absent or trader unavailable");

      if (traderId && await tableExists(transaction, "portfolio_snapshots")) {
        for (let day = 0; day < 10; day += 1) {
          const snapshot = new Date(Date.parse(timestamp) - day * 86_400_000).toISOString();
          const totalValue = (10500000 + day * 125000).toFixed(2);
          await transaction`INSERT INTO portfolio_snapshots (user_id, snapshot_date, total_value, total_cost, realized_pnl, unrealized_pnl, currency, created_at)
            SELECT ${traderId}, ${snapshot}, ${totalValue}, '10000000.00', '125000.00', ${String(day * 10000)}, 'NGN', ${timestamp}
            WHERE NOT EXISTS (SELECT 1 FROM portfolio_snapshots WHERE user_id = ${traderId} AND snapshot_date = ${snapshot})`;
        }
        result.inserted.push("portfolio_snapshots");
      } else result.skipped.push("portfolio_snapshots: table absent or trader unavailable");

      if (await tableExists(transaction, "settlements")) {
        for (const order of orderRows.slice(0, 2)) {
          await transaction`INSERT INTO settlements (order_id, user_id, symbol, asset_class, side, quantity, price, gross_amount, fee, net_amount, currency, status, settlement_date, notes, created_at, updated_at)
            VALUES (${order.id}, ${order.user_id}, ${order.symbol}, 'COMMODITY', ${order.side}, ${order.quantity}, ${order.price}, 780000, 780, 779220, 'NGN', 'SETTLED', ${timestamp}, ${`Synthetic settlement ${runId}`}, ${timestamp}, ${timestamp})
            ON CONFLICT (order_id) DO NOTHING`;
        }
        result.inserted.push("settlements");
      } else result.skipped.push("settlements: table absent");

      if (await tableExists(transaction, "bank_accounts")) {
        const accounts = [["farmer-01", "TST-BANK-FARMER-01", "SAVINGS", "Farmer savings account", 350000000], ["trader-01", "TST-BANK-TRADER-01", "SETTLEMENT", "Trader settlement account", 1200000000], ["broker-01", "TST-BANK-BROKER-01", "CURRENT", "Broker current account", 85000000]];
        for (const [userKey, accountRef, type, label, balanceKobo] of accounts) {
          const userId = userIds[userKey];
          if (!userId) continue;
          await transaction`INSERT INTO bank_accounts (user_id, account_ref, type, label, currency, balance_kobo, avail_balance_kobo, status, created_at, updated_at)
            VALUES (${userId}, ${accountRef}, ${type}, ${label}, 'NGN', ${balanceKobo}, ${balanceKobo}, 'ACTIVE', ${timestamp}, ${timestamp})
            ON CONFLICT (account_ref) DO NOTHING`;
        }
        result.inserted.push("bank_accounts");
      } else result.skipped.push("bank_accounts: table absent");

      if (await tableExists(transaction, "bank_transactions")) {
        const accounts = await transaction`SELECT id, user_id, account_ref, balance_kobo FROM bank_accounts WHERE account_ref LIKE 'TST-BANK-%'`;
        for (const account of accounts) {
          const key = `TST-BANK-TXN-${account.account_ref}`;
          await transaction`INSERT INTO bank_transactions (account_id, user_id, type, amount_kobo, balance_after_kobo, currency, narrative, idempotency_key, reference, value_date, created_at)
            VALUES (${account.id}, ${account.user_id}, 'CREDIT', 10000000, ${account.balance_kobo}, 'NGN', ${`Synthetic opening balance ${runId}`}, ${key}, ${runId}, ${timestamp}, ${timestamp})
            ON CONFLICT (idempotency_key) DO NOTHING`;
        }
        result.inserted.push("bank_transactions");
      } else result.skipped.push("bank_transactions: table absent");

      if (traderId && await tableExists(transaction, "tb_transfer_log")) {
        for (const [transferId, debitAccountId, creditAccountId, amount, referenceId] of [["TST-TB-TRANSFER-001", "TST-LEDGER-TRADER", "TST-LEDGER-SETTLEMENT", 2500000, "TST-ORDER-001"], ["TST-TB-TRANSFER-002", "TST-LEDGER-SETTLEMENT", "TST-LEDGER-TRADER", 125000, "TST-SETTLEMENT-FEE-001"]]) {
          await transaction`INSERT INTO tb_transfer_log (transfer_id, debit_account_id, credit_account_id, amount, currency, user_id, reference_id, reference_type, code, status, correlation_id, created_at)
            VALUES (${transferId}, ${debitAccountId}, ${creditAccountId}, ${amount}, 'NGN', ${traderId}, ${referenceId}, 'test_seed', 1, 'COMMITTED', ${runId}, ${timestamp})
            ON CONFLICT (transfer_id) DO NOTHING`;
        }
        result.inserted.push("tb_transfer_log");
      } else result.skipped.push("tb_transfer_log: table absent or trader unavailable");

      if (traderId && await tableExists(transaction, "ledger_accounts")) {
        for (const [id, accountType, balance] of [["TST-LEDGER-TRADER", "TRADING", "1000000.00000000"], ["TST-LEDGER-SETTLEMENT", "SETTLEMENT", "1000000.00000000"]]) {
          await transaction`INSERT INTO ledger_accounts (id, user_id, account_type, currency, balance, pending_debit, pending_credit, status, version, created_at, updated_at)
            VALUES (${id}, ${traderId}, ${accountType}, 'NGN', ${balance}, '0', '0', 'active', 0, ${timestamp}, ${timestamp})
            ON CONFLICT (id) DO NOTHING`;
        }
        result.inserted.push("ledger_accounts");
      } else result.skipped.push("ledger_accounts: table absent or trader unavailable");

      if (await tableExists(transaction, "ledger_entries")) {
        for (const [id, accountId, entryType, amount] of [["TST-JOURNAL-001-DEBIT", "TST-LEDGER-TRADER", "DEBIT", "25000.00000000"], ["TST-JOURNAL-001-CREDIT", "TST-LEDGER-SETTLEMENT", "CREDIT", "25000.00000000"]]) {
          await transaction`INSERT INTO ledger_entries (id, journal_id, account_id, entry_type, amount, currency, reference_type, reference_id, description, metadata, created_at)
            SELECT ${id}, 'TST-JOURNAL-001', ${accountId}, ${entryType}, ${amount}, 'NGN', 'test_seed', ${runId}, 'Synthetic balanced journal', ${JSON.stringify({ seedRunId: runId, synthetic: true })}::jsonb, ${timestamp}
            WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE id = ${id})`;
        }
        result.inserted.push("ledger_entries");
      } else result.skipped.push("ledger_entries: table absent");

      if (farmerId && await tableExists(transaction, "kyc_queue")) {
        await transaction`INSERT INTO kyc_queue (user_id, status, reviewed_by, review_notes, documents, submitted_at, reviewed_at)
          SELECT ${farmerId}, 'APPROVED', ${adminId ?? null}, ${`Synthetic KYC test record ${runId}`}, ${JSON.stringify({ synthetic: true, documents: [] })}::jsonb, ${timestamp}, ${timestamp}
          WHERE NOT EXISTS (SELECT 1 FROM kyc_queue WHERE user_id = ${farmerId})`;
        result.inserted.push("kyc_queue");
      } else result.skipped.push("kyc_queue: table absent or farmer unavailable");

      if (await tableExists(transaction, "notifications")) {
        for (const [index, user] of users.slice(0, 4).entries()) {
          const userId = userIds[user.key];
          if (!userId) continue;
          await transaction`INSERT INTO notifications (user_id, title, message, type, read, metadata, created_at)
            SELECT ${userId}, ${`Synthetic assurance notification ${index + 1}`}, ${`Synthetic test message for ${runId}; no live customer action required.`}, 'SYSTEM', false, ${JSON.stringify({ seedRunId: runId, synthetic: true })}::jsonb, ${timestamp}
            WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = ${userId} AND title = ${`Synthetic assurance notification ${index + 1}`})`;
        }
        result.inserted.push("notifications");
      } else result.skipped.push("notifications: table absent");

      if (await tableExists(transaction, "audit_log")) {
        const auditEvents = ["seed.started", "identity.seeded", "market.seeded", "ledger.seeded", "seed.completed"];
        for (const action of auditEvents) {
          await transaction`INSERT INTO audit_log (user_id, action, resource, resource_id, details, ip_address, created_at)
            SELECT ${adminId ?? null}, ${action}, 'assurance_seed', ${runId}, ${JSON.stringify({ seedRunId: runId, synthetic: true, action })}::jsonb, '127.0.0.1', ${timestamp}
            WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE resource = 'assurance_seed' AND resource_id = ${runId} AND action = ${action})`;
        }
        result.inserted.push("audit_log");
      } else result.skipped.push("audit_log: table absent");

      if (await tableExists(transaction, "workflow_executions")) {
        for (const [workflowType, workflowId, status] of [["test.onboarding", "TST-WF-ONBOARD-001", "COMPLETED"], ["test.settlement", "TST-WF-SETTLE-001", "COMPLETED"], ["test.reconciliation", "TST-WF-RECON-001", "COMPLETED"]]) {
          await transaction`INSERT INTO workflow_executions (workflow_type, workflow_id, user_id, status, input, result, started_at, completed_at)
            SELECT ${workflowType}, ${workflowId}, ${traderId ?? null}, ${status}, ${JSON.stringify({ seedRunId: runId, synthetic: true })}::jsonb, ${JSON.stringify({ outcome: "test_data_seeded" })}::jsonb, ${timestamp}, ${timestamp}
            WHERE NOT EXISTS (SELECT 1 FROM workflow_executions WHERE workflow_id = ${workflowId})`;
        }
        result.inserted.push("workflow_executions");
      } else result.skipped.push("workflow_executions: table absent");
    });
    return result;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (!apply) {
  writePlan({ mode: "dry-run", result: "No database connection made. Use --apply with explicit test-only acknowledgement to seed a local development/test database." });
  console.log("Dry run complete. No database connection or mutation occurred.");
} else {
  seedDatabase().then((result) => {
    writePlan(result);
    console.log(`Seed applied safely: inserted groups=${result.inserted.length}, reused groups=${result.reused.length}, skipped groups=${result.skipped.length}.`);
  }).catch((error) => {
    writePlan({ mode: "apply", result: "failed", error: error.message });
    console.error(`Seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}
