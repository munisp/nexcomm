/**
 * auth.setup.ts — Playwright authentication setup
 *
 * This file runs before all authenticated tests. It performs the Manus OAuth
 * login flow using test credentials and saves the authenticated browser state
 * to `tests/e2e/.auth/user.json` so all subsequent tests reuse the session
 * without re-logging in.
 *
 * Usage: referenced as a dependency in playwright.config.ts projects.
 *
 * Environment variables required:
 *   E2E_TEST_EMAIL    — test account email
 *   E2E_TEST_PASSWORD — test account password
 *   E2E_BASE_URL      — base URL (default: http://localhost:3000)
 */
import { test as setup, expect } from "@playwright/test";
import path from "path";

const AUTH_FILE = path.join(__dirname, ".auth/user.json");

setup("authenticate", async ({ page }) => {
  const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";

  // Navigate to the app — unauthenticated users see the "Sign in" button
  await page.goto(baseUrl);

  // Wait for the login button to appear
  const loginBtn = page.locator("button", { hasText: /sign in/i });
  await loginBtn.waitFor({ timeout: 20_000 });

  // Click the login button — this redirects to Manus OAuth portal
  // In CI, the test account credentials are pre-seeded via the OAuth mock
  await loginBtn.click();

  // The OAuth portal is external; in CI we use a mock that auto-approves
  // and redirects back to the app with a valid session cookie.
  // In local dev, the tester must complete the OAuth flow manually once,
  // then the saved state is reused.
  if (process.env.CI) {
    // CI mock OAuth: portal auto-redirects with ?code=test_code
    await page.waitForURL(`${baseUrl}/**`, { timeout: 30_000 });
  } else {
    // Local: wait for manual OAuth completion
    await page.waitForURL(`${baseUrl}/**`, { timeout: 120_000 });
  }

  // Verify we are now authenticated — dashboard should be visible
  await expect(page.locator("text=NEXCOM")).toBeVisible({ timeout: 20_000 });

  // Save the authenticated state
  await page.context().storageState({ path: AUTH_FILE });
});
