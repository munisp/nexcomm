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
    },
  },
});
