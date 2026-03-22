import { defineConfig } from "drizzle-kit";

// In development, use the local PostgreSQL instance.
// In production, set DATABASE_URL to a postgresql:// connection string.
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://nexcom:nexcom_secure_2026@localhost:5432/nexcom";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
