/**
 * NEXCOM Exchange — Comprehensive Seed Data
 * Run with: npx tsx drizzle/seed.ts
 * Requires: DATABASE_URL environment variable pointing to PostgreSQL
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

async function main() {
  console.log("[Seed] Starting NEXCOM Exchange seed...");

  // 1. Warehouses master table
  await db.insert(schema.warehouses).values([
    { name: "Lagos Grain Terminal", location: "Apapa, Lagos", capacity: 50000, operatorId: null, status: "active", createdAt: new Date() },
    { name: "Kano Commodity Hub", location: "Kano Industrial Estate", capacity: 35000, operatorId: null, status: "active", createdAt: new Date() },
    { name: "Port Harcourt Cold Store", location: "Trans-Amadi, PH", capacity: 20000, operatorId: null, status: "active", createdAt: new Date() },
    { name: "Abuja Distribution Centre", location: "Kubwa, FCT", capacity: 15000, operatorId: null, status: "active", createdAt: new Date() },
  ]).onConflictDoNothing();
  console.log("[Seed] Warehouses seeded");

  // 2. Users
  await db.insert(schema.users).values([
    { openId: "owner-001", name: "Platform Admin", email: "admin@nexcom.ng", role: "admin", createdAt: new Date(), updatedAt: new Date() },
    { openId: "trader-001", name: "Amaka Okonkwo", email: "amaka@nexcom.ng", role: "user", createdAt: new Date(), updatedAt: new Date() },
    { openId: "trader-002", name: "Emeka Nwosu", email: "emeka@nexcom.ng", role: "user", createdAt: new Date(), updatedAt: new Date() },
    { openId: "broker-001", name: "Chidi Investments Ltd", email: "chidi@nexcom.ng", role: "user", createdAt: new Date(), updatedAt: new Date() },
    { openId: "farmer-001", name: "Bello Farms", email: "bello@nexcom.ng", role: "user", createdAt: new Date(), updatedAt: new Date() },
    { openId: "warehouse-001", name: "Lagos Grain Terminal Ops", email: "ops@lagosgrain.ng", role: "user", createdAt: new Date(), updatedAt: new Date() },
    { openId: "regulator-001", name: "SEC Nigeria Observer", email: "sec@nexcom.ng", role: "user", createdAt: new Date(), updatedAt: new Date() },
    { openId: "mm-001", name: "Zenith Market Makers", email: "mm@zenith.ng", role: "user", createdAt: new Date(), updatedAt: new Date() },
    { openId: "coop-001", name: "Kano Farmers Cooperative", email: "coop@kano.ng", role: "user", createdAt: new Date(), updatedAt: new Date() },
    { openId: "clearing-001", name: "CSCS Clearing Member", email: "clearing@cscs.ng", role: "user", createdAt: new Date(), updatedAt: new Date() },
  ]).onConflictDoNothing();
  console.log("[Seed] Users seeded");

  // 3. Instruments master table
  await db.insert(schema.instruments).values([
    { symbol: "MAIZE-NGN", name: "White Maize (NGN)", assetClass: "commodity", currency: "NGN", lotSize: 1000, tickSize: "0.01", minNotional: "50000", status: "active", tradingHoursStart: "09:00", tradingHoursEnd: "16:00", createdAt: new Date() },
    { symbol: "SORGHUM-NGN", name: "Sorghum (NGN)", assetClass: "commodity", currency: "NGN", lotSize: 1000, tickSize: "0.01", minNotional: "50000", status: "active", tradingHoursStart: "09:00", tradingHoursEnd: "16:00", createdAt: new Date() },
    { symbol: "SOYBEAN-NGN", name: "Soybean (NGN)", assetClass: "commodity", currency: "NGN", lotSize: 500, tickSize: "0.01", minNotional: "50000", status: "active", tradingHoursStart: "09:00", tradingHoursEnd: "16:00", createdAt: new Date() },
    { symbol: "SESAME-NGN", name: "Sesame Seed (NGN)", assetClass: "commodity", currency: "NGN", lotSize: 500, tickSize: "0.01", minNotional: "50000", status: "active", tradingHoursStart: "09:00", tradingHoursEnd: "16:00", createdAt: new Date() },
    { symbol: "COCOA-NGN", name: "Cocoa Beans (NGN)", assetClass: "commodity", currency: "NGN", lotSize: 1000, tickSize: "0.01", minNotional: "100000", status: "active", tradingHoursStart: "09:00", tradingHoursEnd: "16:00", createdAt: new Date() },
    { symbol: "CASHEW-NGN", name: "Cashew Nuts (NGN)", assetClass: "commodity", currency: "NGN", lotSize: 500, tickSize: "0.01", minNotional: "50000", status: "active", tradingHoursStart: "09:00", tradingHoursEnd: "16:00", createdAt: new Date() },
    { symbol: "GROUNDNUT-NGN", name: "Groundnut (NGN)", assetClass: "commodity", currency: "NGN", lotSize: 1000, tickSize: "0.01", minNotional: "50000", status: "active", tradingHoursStart: "09:00", tradingHoursEnd: "16:00", createdAt: new Date() },
    { symbol: "COTTON-NGN", name: "Cotton (NGN)", assetClass: "commodity", currency: "NGN", lotSize: 1000, tickSize: "0.01", minNotional: "50000", status: "active", tradingHoursStart: "09:00", tradingHoursEnd: "16:00", createdAt: new Date() },
    { symbol: "RICE-NGN", name: "Paddy Rice (NGN)", assetClass: "commodity", currency: "NGN", lotSize: 1000, tickSize: "0.01", minNotional: "50000", status: "active", tradingHoursStart: "09:00", tradingHoursEnd: "16:00", createdAt: new Date() },
    { symbol: "PALM-NGN", name: "Palm Oil (NGN)", assetClass: "commodity", currency: "NGN", lotSize: 500, tickSize: "0.01", minNotional: "50000", status: "active", tradingHoursStart: "09:00", tradingHoursEnd: "16:00", createdAt: new Date() },
    { symbol: "WHEAT-NGN", name: "Hard Wheat (NGN)", assetClass: "commodity", currency: "NGN", lotSize: 1000, tickSize: "0.01", minNotional: "50000", status: "active", tradingHoursStart: "09:00", tradingHoursEnd: "16:00", createdAt: new Date() },
  ]).onConflictDoNothing();
  console.log("[Seed] Instruments seeded");

  // 4. Commodity indices
  await db.insert(schema.commodityIndexes).values([
    { indexCode: "NAXI", name: "Nigerian Agricultural Exchange Index", methodology: "value_weighted", baseValue: "1000.00", baseDate: new Date("2020-01-01"), currentValue: "1247.35", status: "active", createdAt: new Date() },
    { indexCode: "NGGI", name: "Nigerian Grain & Grains Index", methodology: "price_weighted", baseValue: "500.00", baseDate: new Date("2020-01-01"), currentValue: "623.18", status: "active", createdAt: new Date() },
    { indexCode: "AOXI", name: "Agricultural Output Exchange Index", methodology: "equal_weighted", baseValue: "1000.00", baseDate: new Date("2020-01-01"), currentValue: "1089.42", status: "active", createdAt: new Date() },
    { indexCode: "WACCI", name: "West African Commodity & Cash Index", methodology: "laspeyres", baseValue: "1000.00", baseDate: new Date("2020-01-01"), currentValue: "1312.67", status: "active", createdAt: new Date() },
  ]).onConflictDoNothing();
  console.log("[Seed] Commodity indices seeded");

  // 5. Live prices for instruments
  const now = new Date();
  await db.insert(schema.livePrices).values([
    { symbol: "MAIZE-NGN", bidPrice: "285000.00", askPrice: "287500.00", lastPrice: "286000.00", volume: 15000, openPrice: "284000.00", highPrice: "289000.00", lowPrice: "283000.00", updatedAt: now },
    { symbol: "SORGHUM-NGN", bidPrice: "195000.00", askPrice: "197000.00", lastPrice: "196000.00", volume: 8500, openPrice: "194000.00", highPrice: "198000.00", lowPrice: "193000.00", updatedAt: now },
    { symbol: "SOYBEAN-NGN", bidPrice: "420000.00", askPrice: "423000.00", lastPrice: "421500.00", volume: 6200, openPrice: "419000.00", highPrice: "425000.00", lowPrice: "418000.00", updatedAt: now },
    { symbol: "SESAME-NGN", bidPrice: "650000.00", askPrice: "655000.00", lastPrice: "652000.00", volume: 3800, openPrice: "648000.00", highPrice: "658000.00", lowPrice: "647000.00", updatedAt: now },
    { symbol: "COCOA-NGN", bidPrice: "1850000.00", askPrice: "1860000.00", lastPrice: "1855000.00", volume: 2100, openPrice: "1840000.00", highPrice: "1865000.00", lowPrice: "1838000.00", updatedAt: now },
    { symbol: "CASHEW-NGN", bidPrice: "780000.00", askPrice: "785000.00", lastPrice: "782000.00", volume: 4500, openPrice: "778000.00", highPrice: "788000.00", lowPrice: "776000.00", updatedAt: now },
    { symbol: "GROUNDNUT-NGN", bidPrice: "320000.00", askPrice: "323000.00", lastPrice: "321500.00", volume: 7200, openPrice: "319000.00", highPrice: "325000.00", lowPrice: "318000.00", updatedAt: now },
    { symbol: "COTTON-NGN", bidPrice: "245000.00", askPrice: "247500.00", lastPrice: "246000.00", volume: 5600, openPrice: "244000.00", highPrice: "249000.00", lowPrice: "243000.00", updatedAt: now },
    { symbol: "RICE-NGN", bidPrice: "380000.00", askPrice: "383000.00", lastPrice: "381500.00", volume: 9800, openPrice: "379000.00", highPrice: "385000.00", lowPrice: "378000.00", updatedAt: now },
    { symbol: "PALM-NGN", bidPrice: "510000.00", askPrice: "514000.00", lastPrice: "512000.00", volume: 4200, openPrice: "508000.00", highPrice: "516000.00", lowPrice: "507000.00", updatedAt: now },
    { symbol: "WHEAT-NGN", bidPrice: "295000.00", askPrice: "297500.00", lastPrice: "296000.00", volume: 6800, openPrice: "294000.00", highPrice: "299000.00", lowPrice: "293000.00", updatedAt: now },
    { symbol: "MAIZE-USD", bidPrice: "185.50", askPrice: "186.00", lastPrice: "185.75", volume: 3200, openPrice: "185.00", highPrice: "187.00", lowPrice: "184.50", updatedAt: now },
    { symbol: "COCOA-USD", bidPrice: "3420.00", askPrice: "3435.00", lastPrice: "3427.50", volume: 1800, openPrice: "3410.00", highPrice: "3445.00", lowPrice: "3408.00", updatedAt: now },
    { symbol: "CASHEW-USD", bidPrice: "1250.00", askPrice: "1258.00", lastPrice: "1254.00", volume: 2400, openPrice: "1248.00", highPrice: "1262.00", lowPrice: "1246.00", updatedAt: now },
    { symbol: "PALM-USD", bidPrice: "820.00", askPrice: "825.00", lastPrice: "822.50", volume: 3100, openPrice: "818.00", highPrice: "828.00", lowPrice: "817.00", updatedAt: now },
  ]).onConflictDoNothing();
  console.log("[Seed] Live prices seeded");

  console.log("[Seed] NEXCOM Exchange seed complete!");
  await pool.end();
}

main().catch((err) => {
  console.error("[Seed] Fatal error:", err);
  process.exit(1);
});
