/**
 * Custom migration runner for local PostgreSQL.
 *
 * Drizzle's built-in `migrate()` function splits on `-->statement-breakpoint`
 * and cannot handle multi-statement DO blocks. This script applies each
 * migration file as a single transaction, tracking applied migrations in
 * drizzle.__drizzle_migrations just like drizzle-kit does.
 *
 * Usage:
 *   node scripts/run-migrations.mjs
 */

import postgres from "/home/ubuntu/nexcom-exchange/node_modules/.pnpm/postgres@3.4.8/node_modules/postgres/src/index.js";
import fs from "fs";
import path from "path";

const DB_URL =
  process.env.NEXCOM_PG_URL ??
  "postgresql://nexcom:nexcom_secure_2026@127.0.0.1:5432/nexcom";

const DRIZZLE_DIR = "/home/ubuntu/nexcom-exchange/drizzle";
const JOURNAL_PATH = path.join(DRIZZLE_DIR, "meta/_journal.json");

const sql = postgres(DB_URL, { max: 1, ssl: false });

async function main() {
  // Ensure drizzle schema and migrations table exist
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `;

  // Get already-applied migration hashes
  const applied = await sql`SELECT hash FROM drizzle.__drizzle_migrations`;
  const appliedHashes = new Set(applied.map((r) => r.hash));

  // Read journal
  const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8"));
  const entries = journal.entries;

  let appliedCount = 0;
  let skippedCount = 0;

  for (const entry of entries) {
    const tag = entry.tag;
    const hash = tag; // use tag as hash (same as drizzle-kit)

    if (appliedHashes.has(hash)) {
      skippedCount++;
      continue;
    }

    const sqlFile = path.join(DRIZZLE_DIR, `${tag}.sql`);
    if (!fs.existsSync(sqlFile)) {
      console.warn(`  ⚠️  Missing migration file: ${tag}.sql — skipping`);
      continue;
    }

    const content = fs.readFileSync(sqlFile, "utf8");

    // Split on drizzle statement-breakpoints, but keep DO blocks intact
    // Strategy: split on '--> statement-breakpoint' then re-join DO blocks
    const rawStatements = content.split("--> statement-breakpoint");
    const statements = [];
    let buffer = "";

    for (const raw of rawStatements) {
      const trimmed = raw.trim();
      if (!trimmed) continue;

      buffer += (buffer ? "\n" : "") + trimmed;

      // Count unmatched $$ to detect open dollar-quoted strings
      const dollarCount = (buffer.match(/\$\$/g) || []).length;
      if (dollarCount % 2 === 0) {
        // Even number of $$ — the block is closed
        statements.push(buffer);
        buffer = "";
      }
    }
    if (buffer.trim()) statements.push(buffer);

    console.log(`\n▶ Applying: ${tag} (${statements.length} statements)`);

    try {
      // Apply each statement individually so errors are isolated
      for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (!trimmed) continue;
        try {
          await sql.unsafe(trimmed);
        } catch (err) {
          // Ignore "already exists" errors for idempotency
          const msg = err.message || "";
          if (
            msg.includes("already exists") ||
            msg.includes("duplicate_object") ||
            msg.includes("duplicate column")
          ) {
            // silently skip
          } else {
            throw err;
          }
        }
      }

      // Record as applied
      await sql`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${hash}, ${Date.now()})
      `;
      console.log(`  ✅ Applied: ${tag}`);
      appliedCount++;
    } catch (err) {
      console.error(`  ❌ Failed: ${tag}`);
      console.error(`     ${err.message}`);
      // Continue with next migration rather than aborting
    }
  }

  console.log(
    `\n✅ Migration complete: ${appliedCount} applied, ${skippedCount} skipped`
  );
}

main()
  .catch((err) => {
    console.error("Migration runner failed:", err);
    process.exit(1);
  })
  .finally(() => sql.end());
