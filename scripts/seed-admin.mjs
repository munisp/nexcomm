/**
 * seed-admin.mjs — Promote the platform owner to admin role
 *
 * Usage:
 *   node scripts/seed-admin.mjs
 *   node scripts/seed-admin.mjs --email=someone@example.com
 *   node scripts/seed-admin.mjs --open-id=manus_user_abc123
 *
 * The script reads OWNER_OPEN_ID and OWNER_NAME from the environment (already
 * injected by the Manus platform) and sets role = 'admin' on that user row.
 * If the user does not exist yet (first login hasn't happened), the script
 * prints a reminder and exits with code 0 — it is safe to re-run at any time.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

// ── Config ────────────────────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
const OWNER_OPEN_ID = process.env.OWNER_OPEN_ID;
const OWNER_NAME    = process.env.OWNER_NAME ?? "Platform Owner";

if (!DATABASE_URL) {
  console.error("[seed-admin] ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

// Parse CLI flags
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith("--"))
    .map(a => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? true];
    })
);

const targetOpenId = args["open-id"] ?? OWNER_OPEN_ID;
const targetEmail  = args["email"];

if (!targetOpenId && !targetEmail) {
  console.error("[seed-admin] ERROR: No target user specified. Set OWNER_OPEN_ID env var or pass --open-id=... / --email=...");
  process.exit(1);
}

// ── Database ──────────────────────────────────────────────────────────────────
const conn = await mysql.createConnection(DATABASE_URL);

try {
  let rows;

  if (targetEmail) {
    [rows] = await conn.execute(
      "SELECT id, name, email, role, open_id FROM users WHERE email = ? LIMIT 1",
      [targetEmail]
    );
  } else {
    [rows] = await conn.execute(
      "SELECT id, name, email, role, open_id FROM users WHERE open_id = ? LIMIT 1",
      [targetOpenId]
    );
  }

  if (!rows.length) {
    console.warn(
      `[seed-admin] User not found (${targetEmail ? `email=${targetEmail}` : `open_id=${targetOpenId}`}).`,
      "\n  The owner account is created on first login. Please log in once, then re-run this script."
    );
    process.exit(0);
  }

  const user = rows[0];

  if (user.role === "admin") {
    console.log(`[seed-admin] ✓ User "${user.name}" (id=${user.id}) is already admin. No changes made.`);
    process.exit(0);
  }

  await conn.execute("UPDATE users SET role = 'admin' WHERE id = ?", [user.id]);

  console.log(`[seed-admin] ✓ Promoted "${user.name}" (id=${user.id}, email=${user.email}) to admin role.`);
} finally {
  await conn.end();
}
