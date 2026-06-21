/**
 * NEXCOM Exchange — E2E Test Helpers
 *
 * Shared utilities for Playwright tests: page object helpers, auth bypass,
 * and common assertions.
 */
import { Page, expect } from "@playwright/test";

// ─── Navigation helpers ───────────────────────────────────────────────────────

export async function gotoAndWaitForLoad(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  // Wait for the React root to be present (may redirect to OAuth before hydration)
  await page.waitForSelector("#root", { timeout: 10_000 }).catch(() => {
    // If #root is absent (e.g. OAuth redirect), that's fine — auth tests handle it
  });
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Check if the page is showing the login/auth wall.
 * NEXCOM redirects unauthenticated users to the Manus OAuth portal.
 */
export async function isOnLoginPage(page: Page): Promise<boolean> {
  const url = page.url();
  return (
    url.includes("oauth") ||
    url.includes("login") ||
    url.includes("manus.im/auth") ||
    (await page.locator("text=Sign in").count()) > 0
  );
}

/**
 * Assert that the page requires authentication (redirects to login).
 */
export async function expectAuthRequired(page: Page) {
  // Either redirected to OAuth or shows a login prompt
  await page.waitForURL(
    (url) =>
      url.href.includes("oauth") ||
      url.href.includes("login") ||
      url.href.includes("manus.im"),
    { timeout: 10_000 }
  ).catch(async () => {
    // Alternatively, the page may show a "Sign in" button inline
    await expect(
      page.locator("text=Sign in, text=Log in, text=Login").first()
    ).toBeVisible({ timeout: 5_000 });
  });
}

// ─── Common assertions ────────────────────────────────────────────────────────

/**
 * Assert the page title contains the expected text.
 */
export async function expectPageTitle(page: Page, text: string) {
  await expect(page).toHaveTitle(new RegExp(text, "i"));
}

/**
 * Assert no critical console errors are present.
 * Ignores known non-fatal warnings (SW, Kafka, Permify).
 */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Filter known non-fatal infrastructure errors
      if (
        text.includes("rate-limit-redis") ||
        text.includes("Permify") ||
        text.includes("Kafka") ||
        text.includes("OpenSearch") ||
        text.includes("SW") ||
        text.includes("serviceWorker") ||
        // CSP violations from Vite HMR inline scripts in dev mode
        text.includes("Content Security Policy") ||
        text.includes("inline script") ||
        // Vite HMR WebSocket in dev mode
        text.includes("WebSocket") ||
        text.includes("vite") ||
        text.includes("[vite]")
      ) {
        return;
      }
      errors.push(text);
    }
  });
  return errors;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

/**
 * Wait for a toast notification to appear with the given text.
 */
export async function waitForToast(page: Page, text: string | RegExp) {
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: text })
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Dismiss any open toast notifications.
 */
export async function dismissToasts(page: Page) {
  const toasts = page.locator("[data-sonner-toast]");
  const count = await toasts.count();
  for (let i = 0; i < count; i++) {
    await toasts.nth(i).press("Escape").catch(() => {});
  }
}

/**
 * Wait for the loading skeleton to disappear.
 */
export async function waitForSkeletonToDisappear(page: Page) {
  await page
    .locator("[data-skeleton], .animate-pulse")
    .first()
    .waitFor({ state: "hidden", timeout: 15_000 })
    .catch(() => {
      // Skeleton may not be present — that's fine
    });
}
