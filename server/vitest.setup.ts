/**
 * NEXCOM Exchange — Vitest Global Setup
 * Checks PostgreSQL connectivity before the test suite runs.
 * Sets process.env.DB_AVAILABLE="true" when the DB is reachable,
 * so integration tests can use `it.skipIf(process.env.DB_AVAILABLE !== "true")`
 * to gracefully skip when the DB is not accessible (e.g. sandbox/CI without PG).
 */
import postgres from "postgres";

export async function setup() {
  // Note: vitest.config.ts `env` block is NOT available in globalSetup (runs in main process).
  // Fall back to the same local URL used in vitest.config.ts.
  const pgUrl = process.env.NEXCOM_PG_URL ?? "postgresql://nexcom:nexcom123@127.0.0.1:5432/nexcom";
  if (!pgUrl.startsWith("postgresql://") && !pgUrl.startsWith("postgres://")) {
    process.env.DB_AVAILABLE = "false";
    console.log("[vitest.setup] No valid NEXCOM_PG_URL — DB-dependent tests will be skipped");
    return;
  }
  const sql = postgres(pgUrl, { max: 1, idle_timeout: 3, connect_timeout: 5 });
  try {
    await sql`SELECT 1`;
    process.env.DB_AVAILABLE = "true";
    console.log("[vitest.setup] PostgreSQL reachable — all integration tests will run");
  } catch {
    process.env.DB_AVAILABLE = "false";
    console.log("[vitest.setup] PostgreSQL not reachable — DB-dependent tests will be skipped");
  } finally {
    await sql.end({ timeout: 2 });
  }
}
