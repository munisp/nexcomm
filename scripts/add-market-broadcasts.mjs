/**
 * One-shot migration: add market_broadcasts column to telegram_contacts.
 * Run with: node scripts/add-market-broadcasts.mjs
 */
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://nexcom:nexcom_secure_2026@localhost:5432/nexcom";

const sql = postgres(DATABASE_URL, { max: 1, ssl: false });

try {
  await sql`
    ALTER TABLE telegram_contacts
    ADD COLUMN IF NOT EXISTS market_broadcasts BOOLEAN NOT NULL DEFAULT TRUE
  `;
  console.log("✅ market_broadcasts column added (or already existed)");

  // Verify
  const rows = await sql`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'telegram_contacts'
      AND column_name = 'market_broadcasts'
  `;
  console.log("Column info:", rows[0] ?? "not found");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}
