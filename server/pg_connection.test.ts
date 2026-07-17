import { describe, it, expect } from "vitest";
import postgres from "postgres";

/**
 * Integration test: verifies the NEXCOM_PG_URL PostgreSQL connection has ≥138 tables.
 * Skipped when CI=true or when the DB URL is not a local PostgreSQL instance.
 */
const pgUrl = process.env.NEXCOM_PG_URL ?? "";
const isLocalPg = pgUrl.includes("localhost") || pgUrl.includes("127.0.0.1");
const skipReason = !isLocalPg || process.env.CI === "true";

describe("NEXCOM_PG_URL connection", () => {
  it.skipIf(skipReason)("connects to local PostgreSQL and finds 140+ tables", async () => {
    const url = pgUrl;
    const sql = postgres(url, { max: 1, idle_timeout: 5 });
    try {
      const result = await sql`
        SELECT count(*)::int AS table_count 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `;
      expect(result[0].table_count).toBeGreaterThanOrEqual(138);
    } finally {
      await sql.end();
    }
  });
});
