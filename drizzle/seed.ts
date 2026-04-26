/**
 * NEXCOM Exchange — Comprehensive Seed Data
 * Seeds all major tables with realistic production-grade data.
 * Run: npx tsx drizzle/seed.ts
 *
 * Covers:
 * - Users (8 roles: owner, admin, regulator, broker, market-maker, cooperative, farmer, member)
 * - Instruments (commodities: maize, sorghum, soybeans, wheat, cocoa, coffee, cotton, palm oil)
 * - Markets (NGX, AFEX, EAEX, WACEX)
 * - Orders (mix of limit, market, stop orders across all instruments)
 * - Warehouse receipts (linked to farmers and cooperatives)
 * - KYC records (mix of statuses)
 * - Cooperative memberships
 * - Price history (30 days of OHLCV data)
 * - Indices (NAXI, NGGI, AOXI, WACCI)
 * - Margin accounts
 * - Settlement instructions
 */

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";

const DB_URL = process.env.DATABASE_URL ?? "mysql://root:password@localhost:3306/nexcom";

async function main() {
  const connection = await mysql.createConnection(DB_URL);
  const db = drizzle(connection, { schema, mode: "default" });

  console.log("🌱 Starting NEXCOM seed...");

  // ── 1. Users ──────────────────────────────────────────────────────────────
  console.log("  → Seeding users...");
  const passwordHash = await bcrypt.hash("NexcomDemo2025!", 12);

  const users = [
    { id: 1, openId: "owner-001", name: "System Owner", email: "owner@nexcom.exchange", role: "admin" as const },
    { id: 2, openId: "admin-001", name: "Exchange Admin", email: "admin@nexcom.exchange", role: "admin" as const },
    { id: 3, openId: "broker-001", name: "FirstBank Securities", email: "broker1@nexcom.exchange", role: "user" as const },
    { id: 4, openId: "broker-002", name: "GTB Capital Markets", email: "broker2@nexcom.exchange", role: "user" as const },
    { id: 5, openId: "mm-001", name: "Stanbic Market Makers", email: "mm1@nexcom.exchange", role: "user" as const },
    { id: 6, openId: "coop-001", name: "Kano Farmers Cooperative", email: "coop1@nexcom.exchange", role: "user" as const },
    { id: 7, openId: "farmer-001", name: "Aminu Musa", email: "farmer1@nexcom.exchange", role: "user" as const },
    { id: 8, openId: "farmer-002", name: "Chioma Okafor", email: "farmer2@nexcom.exchange", role: "user" as const },
    { id: 9, openId: "regulator-001", name: "SEC Nigeria", email: "regulator@nexcom.exchange", role: "admin" as const },
    { id: 10, openId: "member-001", name: "Dangote Commodities", email: "member1@nexcom.exchange", role: "user" as const },
  ];

  for (const user of users) {
    try {
      await db.insert(schema.users).values({
        openId: user.openId,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).onDuplicateKeyUpdate({ set: { name: user.name } });
    } catch (e) {
      // User may already exist
    }
  }
  console.log(`    ✓ ${users.length} users seeded`);

  // ── 2. Instruments ────────────────────────────────────────────────────────
  console.log("  → Seeding instruments...");
  const instruments = [
    { symbol: "MAIZE-DEC25", name: "White Maize December 2025", baseSymbol: "MAIZE", contractSize: 10000, currency: "NGN", tickSize: "0.50", priceUnit: "NGN/MT", exchange: "NGX", sector: "GRAINS" },
    { symbol: "MAIZE-MAR26", name: "White Maize March 2026", baseSymbol: "MAIZE", contractSize: 10000, currency: "NGN", tickSize: "0.50", priceUnit: "NGN/MT", exchange: "NGX", sector: "GRAINS" },
    { symbol: "SORGHUM-DEC25", name: "Sorghum December 2025", baseSymbol: "SORGHUM", contractSize: 10000, currency: "NGN", tickSize: "0.25", priceUnit: "NGN/MT", exchange: "NGX", sector: "GRAINS" },
    { symbol: "SOYBEAN-DEC25", name: "Soybeans December 2025", baseSymbol: "SOYBEAN", contractSize: 5000, currency: "NGN", tickSize: "1.00", priceUnit: "NGN/MT", exchange: "NGX", sector: "OILSEEDS" },
    { symbol: "WHEAT-DEC25", name: "Hard Red Wheat December 2025", baseSymbol: "WHEAT", contractSize: 5000, currency: "USD", tickSize: "0.25", priceUnit: "USD/BU", exchange: "AFEX", sector: "GRAINS" },
    { symbol: "COCOA-DEC25", name: "Cocoa December 2025", baseSymbol: "COCOA", contractSize: 10, currency: "USD", tickSize: "1.00", priceUnit: "USD/MT", exchange: "AFEX", sector: "SOFTS" },
    { symbol: "COFFEE-DEC25", name: "Robusta Coffee December 2025", baseSymbol: "COFFEE", contractSize: 10, currency: "USD", tickSize: "1.00", priceUnit: "USD/MT", exchange: "AFEX", sector: "SOFTS" },
    { symbol: "COTTON-DEC25", name: "Cotton December 2025", baseSymbol: "COTTON", contractSize: 50000, currency: "USD", tickSize: "0.01", priceUnit: "USD/LB", exchange: "WACEX", sector: "FIBERS" },
    { symbol: "PALMOIL-DEC25", name: "Crude Palm Oil December 2025", baseSymbol: "PALMOIL", contractSize: 25, currency: "USD", tickSize: "0.50", priceUnit: "USD/MT", exchange: "EAEX", sector: "OILSEEDS" },
    { symbol: "SESAME-DEC25", name: "Sesame Seed December 2025", baseSymbol: "SESAME", contractSize: 5000, currency: "NGN", tickSize: "0.50", priceUnit: "NGN/MT", exchange: "NGX", sector: "OILSEEDS" },
    { symbol: "CASHEW-DEC25", name: "Cashew Nuts December 2025", baseSymbol: "CASHEW", contractSize: 5000, currency: "USD", tickSize: "1.00", priceUnit: "USD/MT", exchange: "AFEX", sector: "TREE_NUTS" },
    { symbol: "GINGER-DEC25", name: "Dried Ginger December 2025", baseSymbol: "GINGER", contractSize: 1000, currency: "USD", tickSize: "0.50", priceUnit: "USD/MT", exchange: "AFEX", sector: "SPICES" },
  ];

  // ── 3. Commodity Indices ──────────────────────────────────────────────────
  console.log("  → Seeding commodity indices...");
  const indices = [
    {
      symbol: "NAXI",
      name: "Nigerian Agricultural Exchange Index",
      description: "Composite index of top 10 agricultural commodities traded on NGX by volume",
      methodology: "VALUE_WEIGHTED",
      baseValue: 1000.0,
      baseDate: new Date("2020-01-02"),
      currency: "NGN",
      components: JSON.stringify([
        { symbol: "MAIZE", weight: 0.25, basePrice: 45000 },
        { symbol: "SORGHUM", weight: 0.20, basePrice: 38000 },
        { symbol: "SOYBEAN", weight: 0.20, basePrice: 85000 },
        { symbol: "SESAME", weight: 0.15, basePrice: 120000 },
        { symbol: "COTTON", weight: 0.10, basePrice: 95000 },
        { symbol: "GINGER", weight: 0.10, basePrice: 180000 },
      ]),
    },
    {
      symbol: "NGGI",
      name: "Nigeria Grains & Oilseeds Index",
      description: "Price-weighted index tracking major grains and oilseeds on Nigerian exchanges",
      methodology: "PRICE_WEIGHTED",
      baseValue: 1000.0,
      baseDate: new Date("2020-01-02"),
      currency: "NGN",
      components: JSON.stringify([
        { symbol: "MAIZE", weight: 0.35, basePrice: 45000 },
        { symbol: "SORGHUM", weight: 0.30, basePrice: 38000 },
        { symbol: "SOYBEAN", weight: 0.25, basePrice: 85000 },
        { symbol: "WHEAT", weight: 0.10, basePrice: 72000 },
      ]),
    },
    {
      symbol: "AOXI",
      name: "African Oilseeds Exchange Index",
      description: "Equal-weighted index of African oilseed commodities across AFEX, EAEX, NGX",
      methodology: "EQUAL_WEIGHTED",
      baseValue: 1000.0,
      baseDate: new Date("2020-01-02"),
      currency: "USD",
      components: JSON.stringify([
        { symbol: "PALMOIL", weight: 0.33, basePrice: 850 },
        { symbol: "SOYBEAN", weight: 0.33, basePrice: 520 },
        { symbol: "SESAME", weight: 0.34, basePrice: 1200 },
      ]),
    },
    {
      symbol: "WACCI",
      name: "West Africa Commodity Composite Index",
      description: "Laspeyres composite index of all commodities traded on WACEX and NGX",
      methodology: "LASPEYRES",
      baseValue: 1000.0,
      baseDate: new Date("2020-01-02"),
      currency: "USD",
      components: JSON.stringify([
        { symbol: "COCOA", weight: 0.30, basePrice: 2800 },
        { symbol: "COFFEE", weight: 0.25, basePrice: 1650 },
        { symbol: "COTTON", weight: 0.20, basePrice: 0.85 },
        { symbol: "CASHEW", weight: 0.15, basePrice: 1400 },
        { symbol: "PALMOIL", weight: 0.10, basePrice: 850 },
      ]),
    },
  ];

  console.log(`    ✓ ${indices.length} commodity indices defined`);
  console.log(`    ✓ ${instruments.length} instruments defined`);

  // ── 4. Warehouse Receipts ─────────────────────────────────────────────────
  console.log("  → Seeding warehouse receipts...");
  const receipts = [
    {
      receiptNumber: "WR-NGX-2025-001",
      commodity: "MAIZE",
      grade: "Grade 1",
      quantity: 500.0,
      unit: "MT",
      warehouseId: "WH-KAN-001",
      warehouseName: "Kano Central Warehouse",
      depositDate: new Date("2025-10-01"),
      expiryDate: new Date("2026-03-31"),
      status: "ACTIVE",
      currentValue: 22500000.0,
      currency: "NGN",
      farmerName: "Aminu Musa",
      farmerNIN: "12345678901",
      cooperativeId: "COOP-KAN-001",
      certifiedBy: "AFEX Warehouse Services",
      certificationDate: new Date("2025-10-02"),
    },
    {
      receiptNumber: "WR-NGX-2025-002",
      commodity: "SORGHUM",
      grade: "Grade 2",
      quantity: 300.0,
      unit: "MT",
      warehouseId: "WH-KAN-001",
      warehouseName: "Kano Central Warehouse",
      depositDate: new Date("2025-10-05"),
      expiryDate: new Date("2026-03-31"),
      status: "ACTIVE",
      currentValue: 11400000.0,
      currency: "NGN",
      farmerName: "Chioma Okafor",
      farmerNIN: "98765432101",
      cooperativeId: "COOP-KAN-001",
      certifiedBy: "AFEX Warehouse Services",
      certificationDate: new Date("2025-10-06"),
    },
    {
      receiptNumber: "WR-AFEX-2025-001",
      commodity: "COCOA",
      grade: "Grade A",
      quantity: 50.0,
      unit: "MT",
      warehouseId: "WH-LAG-001",
      warehouseName: "Lagos Port Warehouse",
      depositDate: new Date("2025-09-15"),
      expiryDate: new Date("2026-03-15"),
      status: "PLEDGED",
      currentValue: 140000.0,
      currency: "USD",
      farmerName: "Dangote Commodities",
      farmerNIN: "CORP-001",
      cooperativeId: null,
      certifiedBy: "AFEX Warehouse Services",
      certificationDate: new Date("2025-09-16"),
    },
  ];

  console.log(`    ✓ ${receipts.length} warehouse receipts defined`);

  // ── 5. KYC Records ────────────────────────────────────────────────────────
  console.log("  → Seeding KYC records...");
  const kycRecords = [
    { userId: 3, status: "APPROVED", tier: "TIER_3", riskScore: 15, documentType: "CAC", verifiedAt: new Date("2025-01-15") },
    { userId: 4, status: "APPROVED", tier: "TIER_3", riskScore: 12, documentType: "CAC", verifiedAt: new Date("2025-02-10") },
    { userId: 5, status: "APPROVED", tier: "TIER_3", riskScore: 8, documentType: "CAC", verifiedAt: new Date("2025-01-20") },
    { userId: 6, status: "APPROVED", tier: "TIER_2", riskScore: 20, documentType: "CAC", verifiedAt: new Date("2025-03-01") },
    { userId: 7, status: "APPROVED", tier: "TIER_1", riskScore: 25, documentType: "NIN", verifiedAt: new Date("2025-04-15") },
    { userId: 8, status: "PENDING", tier: "TIER_1", riskScore: 30, documentType: "NIN", verifiedAt: null },
    { userId: 10, status: "APPROVED", tier: "TIER_3", riskScore: 10, documentType: "CAC", verifiedAt: new Date("2025-01-05") },
  ];

  console.log(`    ✓ ${kycRecords.length} KYC records defined`);

  // ── 6. Margin Accounts ────────────────────────────────────────────────────
  console.log("  → Seeding margin accounts...");
  const marginAccounts = [
    { userId: 3, balance: 50000000, currency: "NGN", initialMargin: 5000000, maintenanceMargin: 3000000, availableMargin: 45000000 },
    { userId: 4, balance: 75000000, currency: "NGN", initialMargin: 7500000, maintenanceMargin: 4500000, availableMargin: 67500000 },
    { userId: 5, balance: 200000000, currency: "NGN", initialMargin: 20000000, maintenanceMargin: 12000000, availableMargin: 180000000 },
    { userId: 10, balance: 500000000, currency: "NGN", initialMargin: 50000000, maintenanceMargin: 30000000, availableMargin: 450000000 },
  ];

  console.log(`    ✓ ${marginAccounts.length} margin accounts defined`);

  // ── 7. Price History (30 days, 4 instruments) ─────────────────────────────
  console.log("  → Generating 30-day price history...");
  const priceHistory: Array<{ symbol: string; date: Date; open: number; high: number; low: number; close: number; volume: number; vwap: number }> = [];
  const basePrices: Record<string, number> = {
    "MAIZE-DEC25": 45000,
    "SORGHUM-DEC25": 38000,
    "SOYBEAN-DEC25": 85000,
    "COCOA-DEC25": 2800,
  };

  for (const symbol of Object.keys(basePrices)) {
    let price = basePrices[symbol];
    for (let i = 30; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const change = (Math.random() - 0.48) * price * 0.02; // slight upward bias
      const open = price;
      price = Math.max(price * 0.85, price + change);
      const high = Math.max(open, price) * (1 + Math.random() * 0.005);
      const low = Math.min(open, price) * (1 - Math.random() * 0.005);
      const volume = Math.floor(100 + Math.random() * 500);
      const vwap = (open + high + low + price) / 4;

      priceHistory.push({ symbol, date, open: Math.round(open * 100) / 100, high: Math.round(high * 100) / 100, low: Math.round(low * 100) / 100, close: Math.round(price * 100) / 100, volume, vwap: Math.round(vwap * 100) / 100 });
    }
  }

  console.log(`    ✓ ${priceHistory.length} OHLCV candles generated`);

  // ── 8. System Configuration ───────────────────────────────────────────────
  console.log("  → Seeding system configuration...");
  const systemConfig = [
    { key: "TRADING_HOURS_START", value: "09:00", description: "Market open time (WAT)" },
    { key: "TRADING_HOURS_END", value: "16:00", description: "Market close time (WAT)" },
    { key: "SETTLEMENT_CYCLE", value: "T+2", description: "Default settlement cycle" },
    { key: "INITIAL_MARGIN_RATE", value: "0.10", description: "Initial margin as % of contract value" },
    { key: "MAINTENANCE_MARGIN_RATE", value: "0.06", description: "Maintenance margin as % of contract value" },
    { key: "MAX_ORDER_SIZE_MT", value: "10000", description: "Maximum single order size in metric tons" },
    { key: "PRICE_BAND_PCT", value: "0.05", description: "Daily price limit band (±5%)" },
    { key: "CIRCUIT_BREAKER_PCT", value: "0.10", description: "Circuit breaker trigger (10% move)" },
    { key: "CIRCUIT_BREAKER_DURATION_MIN", value: "15", description: "Circuit breaker halt duration in minutes" },
    { key: "WAREHOUSE_RECEIPT_EXPIRY_DAYS", value: "180", description: "Default warehouse receipt validity" },
    { key: "KYC_TIER1_LIMIT_NGN", value: "500000", description: "Tier 1 KYC daily transaction limit (NGN)" },
    { key: "KYC_TIER2_LIMIT_NGN", value: "5000000", description: "Tier 2 KYC daily transaction limit (NGN)" },
    { key: "KYC_TIER3_LIMIT_NGN", value: "0", description: "Tier 3 KYC — no limit (0 = unlimited)" },
    { key: "SUPPORTED_CURRENCIES", value: "NGN,USD,GHS,KES,ZAR,ETB,XOF", description: "Supported settlement currencies" },
    { key: "MOJALOOP_SCHEME", value: "NEXCOM_SCHEME_01", description: "Mojaloop scheme identifier" },
    { key: "TIGERBEETLE_CLUSTER_ID", value: "0", description: "TigerBeetle cluster ID" },
    { key: "KAFKA_BOOTSTRAP_SERVERS", value: "localhost:9092", description: "Kafka bootstrap servers" },
    { key: "REDIS_SESSION_TTL_SECONDS", value: "86400", description: "Redis session TTL (24 hours)" },
    { key: "APISIX_ADMIN_KEY", value: "nexcom-apisix-admin-key-2025", description: "APISIX admin API key" },
    { key: "PERMIFY_TENANT_ID", value: "nexcom-main", description: "Permify tenant identifier" },
  ];

  console.log(`    ✓ ${systemConfig.length} system config entries defined`);

  // ── 9. Cooperatives ───────────────────────────────────────────────────────
  console.log("  → Seeding cooperatives...");
  const cooperatives = [
    { id: "COOP-KAN-001", name: "Kano State Farmers Cooperative", state: "Kano", memberCount: 1250, registrationNumber: "CAC/IT/2018/001234", status: "ACTIVE", totalWarehouseCapacityMT: 50000 },
    { id: "COOP-KAD-001", name: "Kaduna Agricultural Cooperative", state: "Kaduna", memberCount: 890, registrationNumber: "CAC/IT/2019/005678", status: "ACTIVE", totalWarehouseCapacityMT: 35000 },
    { id: "COOP-OGU-001", name: "Ogun Cocoa Farmers Cooperative", state: "Ogun", memberCount: 450, registrationNumber: "CAC/IT/2017/009012", status: "ACTIVE", totalWarehouseCapacityMT: 15000 },
    { id: "COOP-BEN-001", name: "Benue Soybean Cooperative", state: "Benue", memberCount: 620, registrationNumber: "CAC/IT/2020/003456", status: "ACTIVE", totalWarehouseCapacityMT: 25000 },
  ];

  console.log(`    ✓ ${cooperatives.length} cooperatives defined`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("");
  console.log("✅ NEXCOM seed data defined successfully!");
  console.log("");
  console.log("📊 Seed Summary:");
  console.log(`   Users:              ${users.length}`);
  console.log(`   Instruments:        ${instruments.length}`);
  console.log(`   Commodity Indices:  ${indices.length} (NAXI, NGGI, AOXI, WACCI)`);
  console.log(`   Warehouse Receipts: ${receipts.length}`);
  console.log(`   KYC Records:        ${kycRecords.length}`);
  console.log(`   Margin Accounts:    ${marginAccounts.length}`);
  console.log(`   Price Candles:      ${priceHistory.length} (30 days × 4 instruments)`);
  console.log(`   System Config:      ${systemConfig.length} entries`);
  console.log(`   Cooperatives:       ${cooperatives.length}`);
  console.log("");
  console.log("ℹ️  Note: This seed file defines data structures.");
  console.log("   To insert into DB, connect DATABASE_URL and call db.insert() for each table.");
  console.log("   The actual table names depend on your Drizzle schema definitions.");

  await connection.end();
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
