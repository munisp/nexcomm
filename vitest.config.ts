import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

/**
 * Unit tests receive only explicit test configuration supplied by the runner.
 * Authorization remains fail-closed: tests that need a policy decision must set up
 * an authenticated test dependency or assert denial. No development credential or
 * permissive authorization switch is embedded in source control.
 */
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
      NODE_ENV: "test",
      EMAIL_ENABLED: "false",
      NEXCOM_PG_URL: process.env.NEXCOM_PG_URL ?? "",
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? "",
      S3_BUCKET: process.env.S3_BUCKET ?? "",
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? "",
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? "",
      KEYCLOAK_URL: process.env.KEYCLOAK_URL ?? "",
      KEYCLOAK_REALM: process.env.KEYCLOAK_REALM ?? "",
      KEYCLOAK_CLIENT_ID: process.env.KEYCLOAK_CLIENT_ID ?? "",
      KEYCLOAK_CLIENT_SECRET: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
      VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY ?? "",
      VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY ?? "",
      VAPID_SUBJECT: process.env.VAPID_SUBJECT ?? "",
      LLM_BASE_URL: process.env.LLM_BASE_URL ?? "",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
    },
  },
});
