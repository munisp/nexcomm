import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
    globalSetup: ["./server/vitest.setup.ts"],
    env: {
      // Suppress owner notifications (emails/alerts) during test runs.
      NODE_ENV: "test",
      EMAIL_ENABLED: "false",
      // Permify is not running in CI/test — fail-open so permission-guarded
      // procedures are accessible to admin callers in unit tests.
      PERMIFY_FAIL_OPEN: "true",
      // VAPID keys for push notification tests (test-only, not production keys)
      VAPID_PUBLIC_KEY: "BAqUezaDoP0Y5NC704Okm4VJWanZ2517ZnSB8SNBHFp5ptC3qHb5oWdYl2R6Txh_5b00yNBAOr4uWXIYPr5wWmE",
      VAPID_PRIVATE_KEY: "TA_YkUFeRRSKSkOC-p8umVsTqW4xl8JG5qGcz71HPlA",
      VAPID_SUBJECT: "mailto:admin@nexcomexchange.com",
      // Local PostgreSQL — password must match db.ts fallback URL
      NEXCOM_PG_URL: "postgresql://nexcom:nexcom_secure_2026@127.0.0.1:5432/nexcom",
      // S3/MinIO credentials for storage tests (MinIO is not running in CI — tests skip gracefully)
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_BUCKET: "nexcom-test",
      AWS_ACCESS_KEY_ID: "nexcom-minio",
      AWS_SECRET_ACCESS_KEY: "nexcom-minio-secret",
      // Keycloak is not running in CI — auth tests use mock contexts
      KEYCLOAK_URL: "http://127.0.0.1:8080",
      KEYCLOAK_REALM: "nexcom",
      KEYCLOAK_CLIENT_ID: "nexcom-exchange",
      KEYCLOAK_CLIENT_SECRET: "nexcom-exchange-secret",
      // LLM is not running in CI — LLM tests use vi.mock
      LLM_BASE_URL: "http://127.0.0.1:11434/v1",
      OPENAI_API_KEY: "test-openai-key-for-vitest",
    },
  },
});
