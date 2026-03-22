#!/usr/bin/env node
/**
 * NEXCOM Exchange — PostgreSQL Database Seed Script
 * Populates the local PostgreSQL database with realistic demo data.
 *
 * Usage:
 *   node scripts/seed.mjs
 *   DATABASE_URL=postgresql://user:pass@host/db node scripts/seed.mjs
 */

import postgres from "postgres";
import crypto from "crypto";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://nexcom:nexcom_secure_2026@127.0.0.1:5432/nexcom";

const sql = postgres(DATABASE_URL, {
  max: 5,
  ssl: DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost")
    ? false
    : "require",
  onnotice: () => {},
});

const rand  = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max));
const pick  = (arr) => arr[randInt(0, arr.length)];
const daysAgo = (n) => new Date(Date.now() - n * 86400_000);
const daysAhead = (n) => new Date(Date.now() + n * 86400_000);

// ─── Demo users ───────────────────────────────────────────────────────────────
const DEMO_USERS = [
  { openId: "demo-farmer-001",  name: "Aminu Garba",       role: "farmer",  accountType: "FARMER",             state: "Kaduna", phone: "+2348012345678" },
  { openId: "demo-trader-001",  name: "Chukwuemeka Obi",   role: "trader",  accountType: "TRADER",             state: "Lagos",  phone: "+2348023456789" },
  { openId: "demo-broker-001",  name: "Fatima Al-Hassan",  role: "broker",  accountType: "BROKER",             state: "Kano",   phone: "+2348034567890" },
  { openId: "demo-wh-001",      name: "Segun Adeyemi",     role: "user",    accountType: "WAREHOUSE_OPERATOR", state: "Ogun",   phone: "+2348045678901" },
  { openId: "demo-mm-001",      name: "Ngozi Eze",         role: "trader",  accountType: "MARKET_MAKER",       state: "Abuja",  phone: "+2348056789012" },
  { openId: "demo-admin-001",   name: "Ibrahim Musa",      role: "admin",   accountType: "TRADER",             state: "Abuja",  phone: "+2348067890123" },
];

async function seed() {
  console.log("🌱 NEXCOM Exchange — PostgreSQL Seed Script");
  console.log("============================================");
  console.log(`📡 ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}\n`);

  try {
    await sql`SELECT 1`;
    console.log("✅ Connected to PostgreSQL\n");
  } catch (err) {
    console.error("❌ Connection failed:", err.message);
    process.exit(1);
  }

  // ── 1. Users ─────────────────────────────────────────────────────────────────
  console.log("👤 Seeding users...");
  const insertedUsers = [];
  for (const u of DEMO_USERS) {
    try {
      const existing = await sql`SELECT id FROM users WHERE open_id = ${u.openId} LIMIT 1`;
      if (existing.length > 0) {
        insertedUsers.push({ id: existing[0].id, ...u });
        console.log(`   ↩  Exists: ${u.name}`);
        continue;
      }
      const [row] = await sql`
        INSERT INTO users (open_id, name, role, created_at, updated_at, last_signed_in)
        VALUES (${u.openId}, ${u.name}, ${u.role}, NOW(), NOW(), NOW())
        RETURNING id
      `;
      insertedUsers.push({ id: row.id, ...u });
      console.log(`   ✅ ${u.name} (${u.role})`);
    } catch (err) {
      console.warn(`   ⚠️  ${u.name}: ${err.message}`);
    }
  }

  // ── 2. Profiles ──────────────────────────────────────────────────────────────
  console.log("\n📋 Seeding profiles...");
  for (const u of insertedUsers) {
    try {
      const existing = await sql`SELECT id FROM profiles WHERE user_id = ${u.id} LIMIT 1`;
      if (existing.length > 0) { console.log(`   ↩  Exists: ${u.name}`); continue; }
      const [first, ...rest] = u.name.split(" ");
      const last = rest.join(" ") || "";
      await sql`
        INSERT INTO profiles
          (user_id, account_type, first_name, last_name, phone, state, country,
           kyc_status, stakeholder_type, created_at, updated_at)
        VALUES
          (${u.id}, ${u.accountType}, ${first}, ${last}, ${u.phone},
           ${u.state}, 'Nigeria', 'VERIFIED', ${u.accountType},
           NOW(), NOW())
      `;
      console.log(`   ✅ ${u.name}`);
    } catch (err) {
      console.warn(`   ⚠️  ${u.name}: ${err.message}`);
    }
  }

  // ── 3. Warehouse Receipts ────────────────────────────────────────────────────
  console.log("\n🏭 Seeding warehouse receipts...");
  const farmerUser = insertedUsers.find(u => u.role === "farmer");
  const wrData = [
    { commodity: "GINGER",   grade: "G1", qty: 500,  unit: "MT",  warehouse: "Kaduna Central Warehouse",  status: "ACTIVE",   value: 925000  },
    { commodity: "MAIZE",    grade: "A",  qty: 2000, unit: "MT",  warehouse: "Kano Grain Terminal",        status: "ACTIVE",   value: 570000  },
    { commodity: "SOYBEAN",  grade: "A",  qty: 800,  unit: "MT",  warehouse: "Kano Grain Terminal",        status: "PLEDGED",  value: 344000  },
    { commodity: "COCOA",    grade: "A",  qty: 100,  unit: "MT",  warehouse: "Lagos Bonded Warehouse",     status: "ACTIVE",   value: 850000  },
    { commodity: "SESAME",   grade: "A",  qty: 300,  unit: "MT",  warehouse: "Plateau Cold Storage",       status: "ACTIVE",   value: 405000  },
    { commodity: "GINGER",   grade: "G2", qty: 250,  unit: "MT",  warehouse: "Kaduna Central Warehouse",   status: "REDEEMED", value: 440000  },
    { commodity: "COTTON",   grade: "A",  qty: 400,  unit: "MT",  warehouse: "Abuja Agri Hub",             status: "ACTIVE",   value: 700000  },
  ];

  for (const wr of wrData) {
    try {
      const userId = farmerUser?.id || insertedUsers[0]?.id;
      if (!userId) continue;
      const receiptNo = `WR-${Date.now()}-${randInt(1000, 9999)}`;
      await sql`
        INSERT INTO warehouse_receipts
          (user_id, receipt_number, commodity, grade, quantity, unit,
           warehouse_name, deposit_date, expiry_date, status, value_usd,
           created_at, updated_at)
        VALUES
          (${userId}, ${receiptNo}, ${wr.commodity}, ${wr.grade}, ${wr.qty}, ${wr.unit},
           ${wr.warehouse}, ${daysAgo(randInt(10, 90))}, ${daysAhead(180)},
           ${wr.status}, ${wr.value}, NOW(), NOW())
      `;
      console.log(`   ✅ ${wr.commodity} ${wr.qty}${wr.unit} [${wr.status}]`);
    } catch (err) {
      console.warn(`   ⚠️  ${wr.commodity}: ${err.message}`);
    }
  }

  // ── 4. Orders ────────────────────────────────────────────────────────────────
  console.log("\n📊 Seeding orders...");
  const orderData = [
    { symbol: "GINGER-NG-SPOT",  side: "BUY",  type: "LIMIT",  qty: 50,   price: 1820, status: "OPEN" },
    { symbol: "GINGER-NG-SPOT",  side: "SELL", type: "LIMIT",  qty: 100,  price: 1890, status: "OPEN" },
    { symbol: "MAIZE-NG-SPOT",   side: "BUY",  type: "MARKET", qty: 500,  price: 285,  status: "FILLED" },
    { symbol: "COCOA-NG-SPOT",   side: "BUY",  type: "LIMIT",  qty: 20,   price: 8400, status: "OPEN" },
    { symbol: "SOYBEAN-NG-SPOT", side: "SELL", type: "LIMIT",  qty: 200,  price: 435,  status: "PARTIALLY_FILLED" },
    { symbol: "GOLD-SPOT",       side: "BUY",  type: "LIMIT",  qty: 5,    price: 2320, status: "FILLED" },
    { symbol: "CRUDE-WTI",       side: "SELL", type: "LIMIT",  qty: 1000, price: 82,   status: "CANCELLED" },
    { symbol: "SESAME-NG-SPOT",  side: "BUY",  type: "LIMIT",  qty: 100,  price: 1340, status: "OPEN" },
    { symbol: "COTTON-NG",       side: "SELL", type: "MARKET", qty: 300,  price: 1750, status: "FILLED" },
    { symbol: "COFFEE-NG",       side: "BUY",  type: "LIMIT",  qty: 50,   price: 3150, status: "OPEN" },
    { symbol: "PEPPER-BLK-NG",   side: "BUY",  type: "LIMIT",  qty: 30,   price: 4100, status: "OPEN" },
    { symbol: "GROUNDNUT-NG",    side: "SELL", type: "LIMIT",  qty: 150,  price: 1060, status: "OPEN" },
  ];

  for (const o of orderData) {
    try {
      const userId = pick(insertedUsers.filter(u => ["trader","broker"].includes(u.role)))?.id
                  || insertedUsers[0]?.id;
      if (!userId) continue;
      const filledQty = o.status === "FILLED" ? o.qty
                      : o.status === "PARTIALLY_FILLED" ? Math.floor(o.qty * 0.4)
                      : 0;
      await sql`
        INSERT INTO orders
          (user_id, symbol, asset_class, side, order_type, quantity, price,
           filled_qty, avg_fill_price, status, time_in_force, created_at, updated_at)
        VALUES
          (${userId}, ${o.symbol}, 'COMMODITY', ${o.side}, ${o.type},
           ${o.qty}, ${o.price}, ${filledQty},
           ${filledQty > 0 ? o.price : null},
           ${o.status}, 'GTC',
           ${daysAgo(randInt(0, 30))}, NOW())
      `;
      console.log(`   ✅ ${o.side} ${o.qty} ${o.symbol} @ ${o.price} [${o.status}]`);
    } catch (err) {
      console.warn(`   ⚠️  ${o.symbol}: ${err.message}`);
    }
  }

  // ── 5. Settlements ────────────────────────────────────────────────────────────
  console.log("\n💰 Seeding settlements...");
  // Link settlements to real filled orders
  const filledOrders = await sql`
    SELECT id, user_id, symbol, quantity, price FROM orders
    WHERE status IN ('FILLED', 'PARTIALLY_FILLED')
    LIMIT 6
  `;

  for (const o of filledOrders) {
    try {
      const gross = o.quantity * o.price;
      const fee   = Math.round(gross * 0.001);
      const status = pick(['SETTLED', 'SETTLED', 'PENDING', 'MATCHED']);
      await sql`
        INSERT INTO settlements
          (order_id, user_id, symbol, asset_class, side, quantity, price,
           gross_amount, fee, net_amount, currency,
           status, settlement_date, created_at, updated_at)
        VALUES
          (${o.id}, ${o.user_id}, ${o.symbol}, 'COMMODITY', 'BUY',
           ${o.quantity}, ${o.price},
           ${gross}, ${fee}, ${gross - fee}, 'USD',
           ${status}, ${daysAgo(randInt(0, 5))},
           ${daysAgo(randInt(5, 10))}, NOW())
        ON CONFLICT DO NOTHING
      `;
      console.log(`   ✅ ${o.symbol} ${o.quantity}MT @ $${o.price} [${status}]`);
    } catch (err) {
      console.warn(`   ⚠️  order ${o.id}: ${err.message}`);
    }
  }

  // ── 6. Notifications ─────────────────────────────────────────────────────────
  console.log("\n🔔 Seeding notifications...");
  const notifData = [
    { type: "TRADE",       title: "Order Filled",           msg: "Your BUY order for 500 MT MAIZE-NG-SPOT has been fully filled at $285.00/MT." },
    { type: "SETTLEMENT",  title: "Settlement Complete",    msg: "Trade settlement for GINGER-NG-SPOT completed. Funds credited to your account." },
    { type: "KYC",         title: "KYC Approved",           msg: "Your identity verification has been approved. You can now trade all asset classes." },
    { type: "ALERT",       title: "Price Alert Triggered",  msg: "GINGER-NG-SPOT crossed above $1,850 — your target price has been reached." },
    { type: "SYSTEM",      title: "Market Open",            msg: "NEXCOM Exchange markets are now open. Session: 09:00–17:00 WAT." },
    { type: "MARGIN_CALL", title: "Margin Call Notice",     msg: "Your margin account requires additional collateral. Please deposit within 24 hours." },
    { type: "TRADE",       title: "Order Partially Filled", msg: "80 MT of your SOYBEAN-NG-SPOT SELL order has been filled at $432/MT." },
    { type: "SYSTEM",      title: "New Feature: ABCP",      msg: "Asset-Backed Commercial Paper instruments are now available on the Fixed Income board." },
  ];

  for (const n of notifData) {
    try {
      const userId = pick(insertedUsers)?.id;
      if (!userId) continue;
      await sql`
        INSERT INTO notifications (user_id, type, title, message, read, created_at)
        VALUES (${userId}, ${n.type}, ${n.title}, ${n.msg}, false, ${daysAgo(randInt(0, 7))})
      `;
      console.log(`   ✅ ${n.title}`);
    } catch (err) {
      console.warn(`   ⚠️  ${n.title}: ${err.message}`);
    }
  }

  // ── 7. Price Alerts ───────────────────────────────────────────────────────────
  console.log("\n🚨 Seeding price alerts...");
  const alertData = [
    { symbol: "GINGER-NG-SPOT",  condition: "ABOVE", price: 1900 },
    { symbol: "MAIZE-NG-SPOT",   condition: "BELOW", price: 270  },
    { symbol: "COCOA-NG-SPOT",   condition: "ABOVE", price: 9000 },
    { symbol: "GOLD-SPOT",       condition: "BELOW", price: 2300 },
    { symbol: "CRUDE-WTI",       condition: "ABOVE", price: 85   },
    { symbol: "SOYBEAN-NG-SPOT", condition: "BELOW", price: 420  },
  ];

  for (const a of alertData) {
    try {
      const userId = pick(insertedUsers)?.id;
      if (!userId) continue;
      await sql`
        INSERT INTO price_alerts
          (user_id, symbol, condition, target_price, triggered, notified, created_at)
        VALUES
          (${userId}, ${a.symbol}, ${a.condition}, ${a.price}, false, false, NOW())
      `;
      console.log(`   ✅ ${a.symbol} ${a.condition} $${a.price}`);
    } catch (err) {
      console.warn(`   ⚠️  ${a.symbol}: ${err.message}`);
    }
  }

  // ── 8. Watchlist ──────────────────────────────────────────────────────────────
  console.log("\n👁  Seeding watchlists...");
  const watchlistSets = [
    ["GINGER-NG-SPOT", "MAIZE-NG-SPOT", "COCOA-NG-SPOT", "SOYBEAN-NG-SPOT"],
    ["GOLD-SPOT", "CRUDE-WTI", "COTTON-NG"],
    ["SESAME-NG-SPOT", "GROUNDNUT-NG", "COFFEE-NG", "PEPPER-BLK-NG"],
  ];
  for (let i = 0; i < insertedUsers.length; i++) {
    const u = insertedUsers[i];
    const symbols = watchlistSets[i % watchlistSets.length];
    for (const symbol of symbols) {
      try {
        await sql`
          INSERT INTO watchlist (user_id, symbol, created_at)
          VALUES (${u.id}, ${symbol}, NOW())
          ON CONFLICT DO NOTHING
        `;
      } catch (_) {}
    }
    console.log(`   ✅ ${u.name}: ${symbols.join(", ")}`);
  }

  // ── 9. KYC Queue ─────────────────────────────────────────────────────────────
  console.log("\n🪪  Seeding KYC queue...");
  for (const u of insertedUsers.slice(0, 3)) {
    try {
      const existing = await sql`SELECT id FROM kyc_queue WHERE user_id = ${u.id} LIMIT 1`;
      if (existing.length > 0) { console.log(`   ↩  Exists: ${u.name}`); continue; }
      await sql`
        INSERT INTO kyc_queue (user_id, status, submitted_at)
        VALUES (${u.id}, 'APPROVED', ${daysAgo(14)})
      `;
      console.log(`   ✅ KYC: ${u.name}`);
    } catch (err) {
      console.warn(`   ⚠️  ${u.name}: ${err.message}`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log("\n============================================");
  console.log("✅ Seed complete! Database summary:");

  const [counts] = await sql`
    SELECT
      (SELECT COUNT(*) FROM users)              AS users,
      (SELECT COUNT(*) FROM profiles)           AS profiles,
      (SELECT COUNT(*) FROM warehouse_receipts) AS warehouse_receipts,
      (SELECT COUNT(*) FROM orders)             AS orders,
      (SELECT COUNT(*) FROM notifications)      AS notifications,
      (SELECT COUNT(*) FROM settlements)        AS settlements,
      (SELECT COUNT(*) FROM price_alerts)       AS price_alerts,
      (SELECT COUNT(*) FROM watchlist)          AS watchlist,
      (SELECT COUNT(*) FROM kyc_queue)          AS kyc_queue
  `;

  console.log(`   Users:              ${counts.users}`);
  console.log(`   Profiles:           ${counts.profiles}`);
  console.log(`   Warehouse Receipts: ${counts.warehouse_receipts}`);
  console.log(`   Orders:             ${counts.orders}`);
  console.log(`   Notifications:      ${counts.notifications}`);
  console.log(`   Settlements:        ${counts.settlements}`);
  console.log(`   Price Alerts:       ${counts.price_alerts}`);
  console.log(`   Watchlist entries:  ${counts.watchlist}`);
  console.log(`   KYC records:        ${counts.kyc_queue}`);
  console.log("\n🎉 NEXCOM Exchange is ready for demo!");

  await sql.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
