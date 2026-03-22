/**
 * NEXCOM Exchange — Database Seed Script
 * Usage: DATABASE_URL=postgresql://... node scripts/seed-db.mjs
 *
 * Seeds the database with sample data for local development:
 * - 1 admin user + 1 regular user
 * - Sample profiles with KYC status
 * - Sample orders (open, partial, filled)
 * - Sample warehouse receipts
 * - Sample notifications
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";

// Resolve local PostgreSQL fallback if DATABASE_URL is not PostgreSQL
const rawUrl = process.env.DATABASE_URL ?? "";
const DATABASE_URL =
  rawUrl.startsWith("postgresql://") || rawUrl.startsWith("postgres://")
    ? rawUrl
    : "postgresql://nexcom:nexcom_secure_2026@localhost:5432/nexcom";

const isLocal =
  DATABASE_URL.includes("localhost") || DATABASE_URL.includes("127.0.0.1");

const client = postgres(DATABASE_URL, { max: 1, ssl: isLocal ? false : "require" });
const db = drizzle(client);

async function checkConnection() {
  try {
    await db.execute(sql`SELECT 1`);
    console.log("✅ Database connection successful");
    return true;
  } catch (e) {
    console.error("❌ Database connection failed:", e.message);
    return false;
  }
}

async function checkMigrations() {
  try {
    // Check if the users table exists (indicates migrations have run)
    const result = await db.execute(
      sql`SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      ) AS exists`
    );
    const exists = result[0]?.exists;
    if (!exists) {
      console.error("❌ Database schema not found. Run 'pnpm db:push' first.");
      return false;
    }
    console.log("✅ Database schema verified");
    return true;
  } catch (e) {
    console.error("❌ Schema check failed:", e.message);
    return false;
  }
}

async function seedUsers() {
  console.log("\n📦 Seeding users...");
  
  // Check if already seeded
  const existing = await db.execute(sql`SELECT COUNT(*) as count FROM users`);
  if (Number(existing[0]?.count) > 0) {
    console.log("   ⏭  Users already seeded, skipping");
    return;
  }

  await db.execute(sql`
    INSERT INTO users (open_id, name, email, role, login_method, last_signed_in)
    VALUES 
      ('admin-seed-001', 'NEXCOM Admin', 'admin@nexcom.exchange', 'admin', 'email', NOW()),
      ('user-seed-001', 'Amara Okafor', 'amara.okafor@example.com', 'user', 'email', NOW()),
      ('user-seed-002', 'Kwame Asante', 'kwame.asante@example.com', 'user', 'email', NOW()),
      ('user-seed-003', 'Fatima Al-Hassan', 'fatima.hassan@example.com', 'user', 'email', NOW())
    ON CONFLICT (open_id) DO NOTHING
  `);
  console.log("   ✅ 4 users seeded");
}

async function seedProfiles() {
  console.log("\n📦 Seeding profiles...");
  
  const existing = await db.execute(sql`SELECT COUNT(*) as count FROM profiles`);
  if (Number(existing[0]?.count) > 0) {
    console.log("   ⏭  Profiles already seeded, skipping");
    return;
  }

  const users = await db.execute(sql`SELECT id, open_id FROM users ORDER BY id LIMIT 4`);
  
  for (const user of users) {
    const isAdmin = user.open_id === 'admin-seed-001';
    await db.execute(sql`
      INSERT INTO profiles (
        user_id, account_type, phone, state, country, kyc_status,
        bank_name, bank_account
      ) VALUES (
        ${user.id},
        ${isAdmin ? 'BROKER' : 'TRADER'},
        ${`+234${Math.floor(Math.random() * 9000000000 + 1000000000)}`},
        'Lagos',
        'Nigeria',
        ${isAdmin ? 'VERIFIED' : (Math.random() > 0.5 ? 'VERIFIED' : 'PENDING')},
        'First Bank Nigeria',
        ${`30${Math.floor(Math.random() * 90000000 + 10000000)}`}
      ) ON CONFLICT DO NOTHING
    `);
  }
  console.log(`   ✅ ${users.length} profiles seeded`);
}

async function seedOrders() {
  console.log("\n📦 Seeding sample orders...");
  
  const existing = await db.execute(sql`SELECT COUNT(*) as count FROM orders`);
  if (Number(existing[0]?.count) > 0) {
    console.log("   ⏭  Orders already seeded, skipping");
    return;
  }

  const users = await db.execute(sql`SELECT id FROM users WHERE open_id != 'admin-seed-001' LIMIT 3`);
  
  const sampleOrders = [
    { symbol: 'GINGER-NG-SPOT', side: 'BUY',  type: 'LIMIT',  price: '1820.00', qty: '50',     filled: '0',   status: 'OPEN',             assetClass: 'COMMODITY'    },
    { symbol: 'MAIZE-NG-SPOT',  side: 'SELL', type: 'LIMIT',  price: '295.00',  qty: '100',    filled: '40',  status: 'PARTIALLY_FILLED', assetClass: 'COMMODITY'    },
    { symbol: 'COCOA-SPOT',     side: 'BUY',  type: 'MARKET', price: '3200.00', qty: '5',      filled: '5',   status: 'FILLED',           assetClass: 'COMMODITY'    },
    { symbol: 'EURUSD',         side: 'BUY',  type: 'LIMIT',  price: '1.0840',  qty: '100000', filled: '0',   status: 'OPEN',             assetClass: 'FOREX'        },
    { symbol: 'GBPUSD',         side: 'SELL', type: 'LIMIT',  price: '1.2650',  qty: '50000',  filled: '0',   status: 'OPEN',             assetClass: 'FOREX'        },
    { symbol: 'GOLD-SPOT',      side: 'BUY',  type: 'LIMIT',  price: '2045.00', qty: '10',     filled: '10',  status: 'FILLED',           assetClass: 'COMMODITY'    },
    { symbol: 'BTC-USD',        side: 'SELL', type: 'LIMIT',  price: '68000.00',qty: '0.5',    filled: '0',   status: 'CANCELLED',        assetClass: 'DIGITAL_ASSET'},
    { symbol: 'ETH-USD',        side: 'BUY',  type: 'MARKET', price: '3500.00', qty: '2',      filled: '2',   status: 'FILLED',           assetClass: 'DIGITAL_ASSET'},
    { symbol: 'DANGCEM',        side: 'BUY',  type: 'LIMIT',  price: '425.00',  qty: '500',    filled: '200', status: 'PARTIALLY_FILLED', assetClass: 'EQUITY'       },
    { symbol: 'GTCO',           side: 'SELL', type: 'LIMIT',  price: '38.50',   qty: '1000',   filled: '0',   status: 'OPEN',             assetClass: 'EQUITY'       },
  ];

  for (const order of sampleOrders) {
    const user = users[Math.floor(Math.random() * users.length)];
    if (!user) continue;
    await db.execute(sql`
      INSERT INTO orders (
        user_id, symbol, side, order_type, price, quantity, filled_qty,
        status, asset_class, notes
      ) VALUES (
        ${user.id}, ${order.symbol}, ${order.side}, ${order.type},
        ${order.price}, ${order.qty}, ${order.filled},
        ${order.status}, ${order.assetClass}, 'Seeded sample order'
      )
    `);
  }
  console.log(`   ✅ ${sampleOrders.length} orders seeded`);
}

async function seedWarehouseReceipts() {
  console.log("\n📦 Seeding warehouse receipts...");
  const existing = await db.execute(sql`SELECT COUNT(*) as count FROM warehouse_receipts`);
  if (Number(existing[0]?.count) > 0) {
    console.log("   ⏭  Warehouse receipts already seeded, skipping");
    return;
  }
  const users = await db.execute(sql`SELECT id FROM users WHERE open_id != 'admin-seed-001' LIMIT 3`);
  const receipts = [
    { commodity: 'GINGER',  grade: 'Grade A', qty: '500',  unit: 'MT', warehouse: 'NEXCOM-WH-LOS-01', name: 'NEXCOM Lagos Warehouse 1',  value: '910000.00',  status: 'ACTIVE'   },
    { commodity: 'MAIZE',   grade: 'Grade B', qty: '2000', unit: 'MT', warehouse: 'NEXCOM-WH-ABJ-01', name: 'NEXCOM Abuja Warehouse 1',  value: '590000.00',  status: 'ACTIVE'   },
    { commodity: 'COCOA',   grade: 'Grade A', qty: '100',  unit: 'MT', warehouse: 'NEXCOM-WH-IBD-01', name: 'NEXCOM Ibadan Warehouse 1', value: '320000.00',  status: 'PLEDGED'  },
    { commodity: 'SESAME',  grade: 'Grade A', qty: '300',  unit: 'MT', warehouse: 'NEXCOM-WH-KAN-01', name: 'NEXCOM Kano Warehouse 1',   value: '450000.00',  status: 'ACTIVE'   },
    { commodity: 'SORGHUM', grade: 'Grade B', qty: '1500', unit: 'MT', warehouse: 'NEXCOM-WH-LOS-02', name: 'NEXCOM Lagos Warehouse 2',  value: '225000.00',  status: 'REDEEMED' },
  ];
  let receiptNum = 1001;
  for (const r of receipts) {
    const user = users[Math.floor(Math.random() * users.length)];
    if (!user) continue;
    await db.execute(sql`
      INSERT INTO warehouse_receipts (
        user_id, receipt_number, commodity, grade, quantity, unit,
        warehouse_id, warehouse_name, value_usd, status, notes
      ) VALUES (
        ${user.id}, ${`EWR-2026-${receiptNum++}`}, ${r.commodity}, ${r.grade},
        ${r.qty}, ${r.unit}, ${r.warehouse}, ${r.name}, ${r.value},
        ${r.status}, 'Seeded sample warehouse receipt'
      )
    `);
  }
  console.log(`   ✅ ${receipts.length} warehouse receipts seeded`);
}

async function seedDepositRequests() {
  console.log("\n📦 Seeding deposit requests...");
  const existing = await db.execute(sql`SELECT COUNT(*) as count FROM deposit_requests`);
  if (Number(existing[0]?.count) > 0) {
    console.log("   ⏭  Deposit requests already seeded, skipping");
    return;
  }
  const users = await db.execute(sql`SELECT id FROM users WHERE open_id != 'admin-seed-001' LIMIT 3`);
  const deposits = [
    { commodity: 'GINGER', grade: 'Grade A', qty: '200', unit: 'MT', warehouse: 'NEXCOM-WH-LOS-01', name: 'NEXCOM Lagos Warehouse 1',  status: 'PENDING'  },
    { commodity: 'MAIZE',  grade: 'Grade B', qty: '500', unit: 'MT', warehouse: 'NEXCOM-WH-ABJ-01', name: 'NEXCOM Abuja Warehouse 1',  status: 'RECEIVED' },
    { commodity: 'COCOA',  grade: 'Grade A', qty: '50',  unit: 'MT', warehouse: 'NEXCOM-WH-IBD-01', name: 'NEXCOM Ibadan Warehouse 1', status: 'GRADED'   },
  ];
  for (const d of deposits) {
    const user = users[Math.floor(Math.random() * users.length)];
    if (!user) continue;
    await db.execute(sql`
      INSERT INTO deposit_requests (
        user_id, commodity, grade, quantity, unit, warehouse_id, warehouse_name, status, notes
      ) VALUES (
        ${user.id}, ${d.commodity}, ${d.grade}, ${d.qty}, ${d.unit},
        ${d.warehouse}, ${d.name}, ${d.status}, 'Seeded sample deposit request'
      )
    `);
  }
  console.log(`   ✅ ${deposits.length} deposit requests seeded`);
}

async function seedDeliveryOrders() {
  console.log("\n📦 Seeding delivery orders...");
  const existing = await db.execute(sql`SELECT COUNT(*) as count FROM delivery_orders`);
  if (Number(existing[0]?.count) > 0) {
    console.log("   ⏭  Delivery orders already seeded, skipping");
    return;
  }
  const users = await db.execute(sql`SELECT id FROM users WHERE open_id != 'admin-seed-001' LIMIT 3`);
  const deliveries = [
    { commodity: 'GINGER', qty: '100', unit: 'MT', address: '123 Industrial Ave, Apapa, Lagos', status: 'PENDING'   },
    { commodity: 'MAIZE',  qty: '300', unit: 'MT', address: '45 Warehouse Road, Kano',          status: 'SCHEDULED' },
    { commodity: 'SESAME', qty: '150', unit: 'MT', address: '78 Port Road, Port Harcourt',       status: 'DELIVERED' },
  ];
  for (const d of deliveries) {
    const user = users[Math.floor(Math.random() * users.length)];
    if (!user) continue;
    await db.execute(sql`
      INSERT INTO delivery_orders (
        user_id, commodity, quantity, unit, delivery_address, status, notes
      ) VALUES (
        ${user.id}, ${d.commodity}, ${d.qty}, ${d.unit},
        ${d.address}, ${d.status}, 'Seeded sample delivery order'
      )
    `);
  }
  console.log(`   ✅ ${deliveries.length} delivery orders seeded`);
}

async function seedNotifications() {
  console.log("\n📦 Seeding notifications...");
  
  const existing = await db.execute(sql`SELECT COUNT(*) as count FROM notifications`);
  if (Number(existing[0]?.count) > 0) {
    console.log("   ⏭  Notifications already seeded, skipping");
    return;
  }

  const users = await db.execute(sql`SELECT id FROM users LIMIT 4`);
  
  const sampleNotifs = [
    { type: 'TRADE',      title: 'Order Filled',               message: 'Your BUY order for 5 MT Cocoa has been filled at $3,200.' },
    { type: 'ALERT',      title: 'Price Alert Triggered',      message: 'GINGER-NG-SPOT has reached your target price of $1,850.' },
    { type: 'KYC',        title: 'KYC Verification Approved',  message: 'Your account has been fully verified. You can now trade all instruments.' },
    { type: 'SYSTEM',     title: 'Market Hours Update',        message: 'NEXCOM commodity markets are open 09:00–17:00 WAT on weekdays.' },
    { type: 'SETTLEMENT', title: 'Deposit Confirmed',          message: 'Your deposit of ₦500,000 has been credited to your account.' },
  ];
  for (const user of users) {
    for (const notif of sampleNotifs.slice(0, 3)) {
      await db.execute(sql`
        INSERT INTO notifications (user_id, type, title, message, read)
        VALUES (${user.id}, ${notif.type}, ${notif.title}, ${notif.message}, false)
      `);
    }
  }
  console.log(`   ✅ Notifications seeded for ${users.length} users`);
}

async function main() {
  console.log("🌱 NEXCOM Exchange — Database Seed Script");
  console.log("==========================================");
  console.log(`📡 Connecting to: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);

  const connected = await checkConnection();
  if (!connected) { await client.end(); process.exit(1); }

  const migrated = await checkMigrations();
  if (!migrated) {
    console.log("\n💡 Run the following command first:");
    console.log("   DATABASE_URL=<your-url> pnpm db:push");
    await client.end();
    process.exit(1);
  }

  await seedUsers();
  await seedProfiles();
  await seedOrders();
  await seedWarehouseReceipts();
  await seedDepositRequests();
  await seedDeliveryOrders();
  await seedNotifications();

  console.log("\n✅ Seed complete!");
  console.log("\n📋 Next steps:");
  console.log("   1. Start the server: pnpm dev");
  console.log("   2. Log in with Manus OAuth");
  console.log("   3. Your account will be auto-promoted to admin if OWNER_OPEN_ID matches");
  
  await client.end();
}

main().catch(async (e) => {
  console.error("❌ Seed failed:", e);
  await client.end();
  process.exit(1);
});
