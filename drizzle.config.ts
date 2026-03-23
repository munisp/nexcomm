import { defineConfig } from "drizzle-kit";

// Priority order for the migration target:
//   1. NEXCOM_PG_URL  — explicit local/hosted PostgreSQL override
//   2. DATABASE_URL   — platform-injected (may be MySQL in some environments; skip if so)
//   3. Fallback       — local sandbox PostgreSQL
const rawUrl =
  process.env.NEXCOM_PG_URL ??
  process.env.DATABASE_URL ??
  "";

// Only use the URL if it is a valid PostgreSQL connection string.
// If the platform injects a MySQL URL, fall back to the local PostgreSQL instance.
const connectionString =
  rawUrl.startsWith("postgresql://") || rawUrl.startsWith("postgres://")
    ? rawUrl
    : "postgresql://nexcom:nexcom_secure_2026@127.0.0.1:5432/nexcom";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
