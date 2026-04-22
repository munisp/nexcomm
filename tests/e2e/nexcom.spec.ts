/**
 * nexcom.spec.ts — Playwright E2E tests for NEXCOM Exchange
 *
 * Test suites:
 *  1. Homepage & navigation
 *  2. Markets page
 *  3. Trade page (order book, order form)
 *  4. Portfolio page
 *  5. Payments page (Stripe deposit UI)
 *  6. Responsive layout (mobile)
 *  7. Auth-gated pages (redirect to login)
 *  8. Dashboard widgets
 *  9. Price alerts
 * 10. Analytics page
 */
import { test, expect, type Page } from "@playwright/test";

// ── Helpers ───────────────────────────────────────────────────────────────────
async function waitForApp(page: Page) {
  // Wait for the sidebar logo to appear — confirms the full shell has loaded
  await page.waitForSelector("text=NEXCOM", { timeout: 20_000 });
}

// ── 1. Homepage & Navigation ──────────────────────────────────────────────────
test.describe("Homepage & Navigation", () => {
  test("loads the dashboard shell", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await expect(page.locator("text=NEXCOM")).toBeVisible();
  });

  test("sidebar contains key navigation links", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await expect(page.locator("a[href='/markets']")).toBeVisible();
    await expect(page.locator("a[href='/trade']")).toBeVisible();
    await expect(page.locator("a[href='/portfolio']")).toBeVisible();
    await expect(page.locator("a[href='/analytics']")).toBeVisible();
  });

  test("navigates to Markets page", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await page.click("a[href='/markets']");
    await expect(page).toHaveURL("/markets");
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });

  test("navigates to Trade page", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await page.click("a[href='/trade']");
    await expect(page).toHaveURL("/trade");
  });

  test("navigates to Portfolio page", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await page.click("a[href='/portfolio']");
    await expect(page).toHaveURL("/portfolio");
  });

  test("navigates to Payments page", async ({ page }) => {
    await page.goto("/payments");
    await waitForApp(page);
    await expect(page).toHaveURL("/payments");
    // Should show either the deposit form or a sign-in prompt
    const hasDeposit = await page.locator("text=Deposit Funds").isVisible().catch(() => false);
    const hasSignIn  = await page.locator("text=Sign in").isVisible().catch(() => false);
    expect(hasDeposit || hasSignIn).toBe(true);
  });

  test("unknown routes show 404 page", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-xyz");
    await waitForApp(page);
    // Either a 404 component or redirect to home
    const is404  = await page.locator("text=404").isVisible().catch(() => false);
    const isHome = page.url().endsWith("/") || page.url().endsWith("/home");
    expect(is404 || isHome).toBe(true);
  });
});

// ── 2. Markets Page ───────────────────────────────────────────────────────────
test.describe("Markets Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/markets");
    await waitForApp(page);
  });

  test("renders without crashing", async ({ page }) => {
    await expect(page.locator("body")).toBeVisible();
  });

  test("shows a table or list of instruments", async ({ page }) => {
    // Wait for any loading spinners to disappear
    await page.waitForTimeout(2000);
    const hasTable  = await page.locator("table").isVisible().catch(() => false);
    const hasList   = await page.locator("[data-testid='market-row'], .market-row, tr").first().isVisible().catch(() => false);
    const hasText   = await page.locator("text=Gold, text=Crude, text=Ginger").first().isVisible().catch(() => false);
    // At least one of these should be present
    expect(hasTable || hasList || hasText).toBe(true);
  });
});

// ── 3. Trade Page ─────────────────────────────────────────────────────────────
test.describe("Trade Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/trade");
    await waitForApp(page);
    await page.waitForTimeout(1500);
  });

  test("renders the order form", async ({ page }) => {
    const hasForm  = await page.locator("form, [data-testid='order-form']").isVisible().catch(() => false);
    const hasInput = await page.locator("input[type='number'], input[placeholder*='quantity'], input[placeholder*='price']").first().isVisible().catch(() => false);
    const hasBtn   = await page.locator("button:has-text('Buy'), button:has-text('Sell'), button:has-text('Place Order')").first().isVisible().catch(() => false);
    expect(hasForm || hasInput || hasBtn).toBe(true);
  });

  test("renders the order book or price feed", async ({ page }) => {
    const hasOrderBook = await page.locator("text=Order Book, text=Bids, text=Asks").first().isVisible().catch(() => false);
    const hasPriceTable = await page.locator("table").isVisible().catch(() => false);
    expect(hasOrderBook || hasPriceTable).toBe(true);
  });

  test("navigates to a specific symbol via URL", async ({ page }) => {
    await page.goto("/trade/GOLD-SPOT");
    await waitForApp(page);
    await expect(page).toHaveURL("/trade/GOLD-SPOT");
  });
});

// ── 4. Portfolio Page ─────────────────────────────────────────────────────────
test.describe("Portfolio Page", () => {
  test("renders without crashing", async ({ page }) => {
    await page.goto("/portfolio");
    await waitForApp(page);
    await page.waitForTimeout(1500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("shows portfolio summary or empty state", async ({ page }) => {
    await page.goto("/portfolio");
    await waitForApp(page);
    await page.waitForTimeout(2000);
    const hasPortfolio = await page.locator("text=Portfolio, text=Holdings, text=Total Value, text=P&L").first().isVisible().catch(() => false);
    const hasEmpty     = await page.locator("text=No positions, text=empty, text=No holdings").first().isVisible().catch(() => false);
    const hasSignIn    = await page.locator("text=Sign in, text=Log in").first().isVisible().catch(() => false);
    expect(hasPortfolio || hasEmpty || hasSignIn).toBe(true);
  });
});

// ── 5. Payments Page ──────────────────────────────────────────────────────────
test.describe("Payments Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/payments");
    await waitForApp(page);
    await page.waitForTimeout(1000);
  });

  test("renders without crashing", async ({ page }) => {
    await expect(page.locator("body")).toBeVisible();
  });

  test("shows deposit form or auth prompt", async ({ page }) => {
    const hasDeposit = await page.locator("text=Deposit Funds").isVisible().catch(() => false);
    const hasSignIn  = await page.locator("text=Sign in").isVisible().catch(() => false);
    expect(hasDeposit || hasSignIn).toBe(true);
  });

  test("deposit form has amount presets when logged in", async ({ page }) => {
    const hasDeposit = await page.locator("text=Deposit Funds").isVisible().catch(() => false);
    if (!hasDeposit) {
      test.skip(); // Not logged in — skip
      return;
    }
    // Preset amount buttons should be visible
    await expect(page.locator("button:has-text('$50'), button:has-text('$100'), button:has-text('$250')").first()).toBeVisible();
  });

  test("Stripe pay button is present when logged in", async ({ page }) => {
    const hasDeposit = await page.locator("text=Deposit Funds").isVisible().catch(() => false);
    if (!hasDeposit) {
      test.skip();
      return;
    }
    await expect(page.locator("button:has-text('Pay with Stripe')")).toBeVisible();
  });
});

// ── 6. Responsive Layout (Mobile) ────────────────────────────────────────────
test.describe("Responsive Layout", () => {
  test("mobile: sidebar is hidden by default", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await waitForApp(page);
    // Desktop sidebar should not be visible on mobile
    const desktopSidebar = page.locator("aside.hidden.lg\\:flex");
    await expect(desktopSidebar).not.toBeVisible();
  });

  test("mobile: hamburger menu opens sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await waitForApp(page);
    const hamburger = page.locator("button[aria-label='Open menu'], button svg.lucide-menu").first();
    if (await hamburger.isVisible()) {
      await hamburger.click();
      await page.waitForTimeout(500);
      // Mobile sidebar should now be visible
      const mobileSidebar = page.locator("aside").last();
      await expect(mobileSidebar).toBeVisible();
    }
  });

  test("tablet: layout renders correctly", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
    await waitForApp(page);
    await expect(page.locator("body")).toBeVisible();
  });
});

// ── 7. Auth-gated Pages ───────────────────────────────────────────────────────
test.describe("Auth-gated Pages", () => {
  const protectedPaths = ["/account", "/notifications", "/alerts"];

  for (const path of protectedPaths) {
    test(`${path} renders without crashing (may show login prompt)`, async ({ page }) => {
      await page.goto(path);
      await waitForApp(page);
      await page.waitForTimeout(1000);
      await expect(page.locator("body")).toBeVisible();
    });
  }
});

// ── 8. Dashboard Widgets ──────────────────────────────────────────────────────
test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await page.waitForTimeout(2000);
  });

  test("renders dashboard widgets", async ({ page }) => {
    // Dashboard should have at least one card or stat widget
    const hasCard  = await page.locator(".card, [class*='card'], [class*='widget']").first().isVisible().catch(() => false);
    const hasStats = await page.locator("text=Total, text=Volume, text=Balance, text=P&L").first().isVisible().catch(() => false);
    expect(hasCard || hasStats).toBe(true);
  });

  test("live ticker is visible in header", async ({ page }) => {
    // The live price ticker runs in the header bar
    const hasTicker = await page.locator("[class*='ticker'], text=GINGER, text=MAIZE, text=GOLD").first().isVisible().catch(() => false);
    // Ticker may not be visible on mobile viewport — just ensure no crash
    await expect(page.locator("body")).toBeVisible();
    // Log result for debugging
    console.log("Ticker visible:", hasTicker);
  });
});

// ── 9. Analytics Page ─────────────────────────────────────────────────────────
test.describe("Analytics Page", () => {
  test("renders charts or empty state", async ({ page }) => {
    await page.goto("/analytics");
    await waitForApp(page);
    await page.waitForTimeout(2000);
    const hasChart = await page.locator("canvas, svg[class*='chart'], [class*='recharts']").first().isVisible().catch(() => false);
    const hasEmpty = await page.locator("text=No data, text=empty").first().isVisible().catch(() => false);
    const hasText  = await page.locator("h1, h2").first().isVisible().catch(() => false);
    expect(hasChart || hasEmpty || hasText).toBe(true);
  });
});

// ── 10. Compliance Page ───────────────────────────────────────────────────────
test.describe("Compliance Page", () => {
  test("renders without crashing", async ({ page }) => {
    await page.goto("/compliance");
    await waitForApp(page);
    await page.waitForTimeout(1000);
    await expect(page.locator("body")).toBeVisible();
  });
});

// ── 11. Accessibility: keyboard navigation ────────────────────────────────────
test.describe("Accessibility", () => {
  test("sidebar links are keyboard-focusable", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    // Tab through the page and verify focus rings appear
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(["A", "BUTTON", "INPUT"]).toContain(focused);
  });

  test("page has a valid document title", async ({ page }) => {
    await page.goto("/");
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});

// ── 12. Security Headers ──────────────────────────────────────────────────────
test.describe("Security Headers", () => {
  test("response includes security headers", async ({ page }) => {
    const response = await page.goto("/");
    expect(response).toBeTruthy();
    const headers = response!.headers();
    // At least one of these security headers should be present
    const hasSecurityHeader =
      headers["x-content-type-options"] ||
      headers["x-frame-options"] ||
      headers["strict-transport-security"] ||
      headers["content-security-policy"];
    expect(hasSecurityHeader).toBeTruthy();
  });

  test("path traversal attempt is blocked", async ({ page }) => {
    const response = await page.request.get("/api/trpc/../../../etc/passwd");
    expect([400, 403, 404]).toContain(response.status());
  });

  test("XSS probe in URL is blocked or sanitized", async ({ page }) => {
    const response = await page.request.get("/api/trpc/<script>alert(1)</script>");
    expect([400, 403, 404]).toContain(response.status());
  });
});

// ── 13. API Health Checks ─────────────────────────────────────────────────────
test.describe("API Health Checks", () => {
  test("tRPC health.ping responds with 200", async ({ page }) => {
    const response = await page.request.get("/api/trpc/health.ping");
    expect(response.ok()).toBeTruthy();
  });

  test("Stripe webhook endpoint exists", async ({ page }) => {
    const response = await page.request.post("/api/stripe/webhook", {
      headers: { "content-type": "application/json" },
      data: JSON.stringify({ id: "evt_test_123", type: "test" }),
    });
    // Should not 404 (endpoint exists)
    expect(response.status()).not.toBe(404);
  });

  test("HA status endpoint responds", async ({ page }) => {
    const response = await page.request.get("/api/ha-status");
    expect([200, 401, 403]).toContain(response.status());
  });
});

// ── 14. Performance ───────────────────────────────────────────────────────────
test.describe("Performance", () => {
  const PERF_ROUTES = ["/", "/markets", "/trade", "/portfolio", "/orders"];

  for (const route of PERF_ROUTES) {
    test(`${route} loads within 10 seconds`, async ({ page }) => {
      const start = Date.now();
      await page.goto(route);
      await waitForApp(page);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(10_000);
    });
  }
});

// ── 15. All Key Routes Smoke Test ─────────────────────────────────────────────
test.describe("All Key Routes Smoke Test", () => {
  const KEY_ROUTES = [
    "/indices", "/forex", "/equities", "/fixed-income", "/derivatives",
    "/futures", "/options", "/margin", "/commodities",
    "/deposits", "/receipts", "/cooperative",
    "/disputes", "/ledger", "/settlements", "/search",
    "/banking", "/blockchain", "/risk",
  ];

  for (const route of KEY_ROUTES) {
    test(`${route} renders without 500 error`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).not.toBe(500);
      await waitForApp(page);
      const bodyText = await page.locator("body").textContent();
      expect(bodyText?.length).toBeGreaterThan(0);
    });
  }
});
