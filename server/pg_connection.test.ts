import { describe, it, expect } from "vitest";
import postgres from "postgres";

describe("NEXCOM_PG_URL connection", () => {
  it("connects to local PostgreSQL and finds 140+ tables", async () => {
    const url = process.env.NEXCOM_PG_URL ?? "postgresql://nexcom:nexcom_secure_2026@127.0.0.1:5432/nexcom";
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
