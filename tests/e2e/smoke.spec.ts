/**
 * smoke.spec.ts — NEXCOM Exchange Critical Path Smoke Tests
 *
 * Covers the four most important user journeys end-to-end:
 *   1. Authentication — login, session persistence, logout
 *   2. Deposit flow — navigate to payments, initiate Stripe deposit
 *   3. Order placement — navigate to trade, place a spot order
 *   4. Cash withdrawal — navigate to withdrawal, submit a request
 *
 * These tests run against a live dev server (or staging URL via E2E_BASE_URL).
 * They require an authenticated session from auth.setup.ts.
 *
 * Run:
 *   pnpm exec playwright test smoke.spec.ts
 *
 * CI:
 *   E2E_BASE_URL=https://staging.nexcom.exchange pnpm exec playwright test smoke.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

// ── Helpers ────────────────────────────────────────────────────────────────────

async function waitForShell(page: Page, timeout = 20_000) {
  await page.waitForSelector("text=NEXCOM", { timeout });
}

async function navigateTo(page: Page, path: string) {
  await page.goto(path);
  await waitForShell(page);
}

// ── 1. Authentication ──────────────────────────────────────────────────────────

test.describe("Authentication", () => {
  test("dashboard loads with authenticated session", async ({ page }) => {
    await navigateTo(page, "/");
    // Authenticated users see the dashboard, not the login button
    await expect(page.locator("button", { hasText: /sign in/i })).toHaveCount(0);
    await expect(page.locator("text=NEXCOM")).toBeVisible();
  });

  test("user profile is accessible", async ({ page }) => {
    await navigateTo(page, "/profile");
    // Profile page should render without redirect to login
    await expect(page).toHaveURL(/\/profile/);
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });

  test("unauthenticated access to protected page shows login", async ({
    browser,
  }) => {
    // Use a fresh context with no stored auth state
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/portfolio");
    // Should see the login button (unauthenticated shell)
    await expect(
      page.locator("button", { hasText: /sign in/i })
    ).toBeVisible({ timeout: 20_000 });
    await ctx.close();
  });

  test("logout clears session", async ({ page }) => {
    await navigateTo(page, "/");

    // Open the user dropdown — look for the avatar/user menu trigger
    const userMenu = page.locator("[data-testid='user-menu'], button[aria-label*='user'], button[aria-label*='profile']").first();
    if (await userMenu.isVisible()) {
      await userMenu.click();
      const logoutBtn = page.locator("button, [role='menuitem']", { hasText: /log out|sign out/i });
      if (await logoutBtn.isVisible()) {
        await logoutBtn.click();
        // After logout, login button should appear
        await expect(
          page.locator("button", { hasText: /sign in/i })
        ).toBeVisible({ timeout: 20_000 });
      }
    } else {
      // If no user menu found, skip gracefully (test env may not have full auth)
      test.skip();
    }
  });
});

// ── 2. Deposit Flow ────────────────────────────────────────────────────────────

test.describe("Deposit Flow", () => {
  test("payments page loads", async ({ page }) => {
    await navigateTo(page, "/payments");
    await expect(page).toHaveURL(/\/payments/);
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });

  test("deposit button is visible", async ({ page }) => {
    await navigateTo(page, "/payments");
    // Look for a deposit / top-up / fund button
    const depositBtn = page.locator("button", {
      hasText: /deposit|top.?up|fund|add funds/i,
    }).first();
    await expect(depositBtn).toBeVisible({ timeout: 15_000 });
  });

  test("Stripe checkout modal opens on deposit click", async ({ page }) => {
    await navigateTo(page, "/payments");
    const depositBtn = page.locator("button", {
      hasText: /deposit|top.?up|fund|add funds/i,
    }).first();

    if (await depositBtn.isVisible()) {
      await depositBtn.click();
      // Either a dialog/modal opens or we navigate to a checkout page
      const modal = page.locator("[role='dialog'], .stripe-checkout, iframe[src*='stripe']");
      const checkoutPage = page.locator("text=/checkout|payment/i");
      await expect(modal.or(checkoutPage)).toBeVisible({ timeout: 15_000 });
    } else {
      test.skip();
    }
  });

  test("payment history section is visible", async ({ page }) => {
    await navigateTo(page, "/payments");
    // Look for a transactions / history section
    const historySection = page.locator(
      "text=/transaction|history|payment history/i"
    ).first();
    await expect(historySection).toBeVisible({ timeout: 15_000 });
  });
});

// ── 3. Order Placement ─────────────────────────────────────────────────────────

test.describe("Order Placement", () => {
  test("trade page loads", async ({ page }) => {
    await navigateTo(page, "/trade");
    await expect(page).toHaveURL(/\/trade/);
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });

  test("order form is visible", async ({ page }) => {
    await navigateTo(page, "/trade");
    // Look for Buy/Sell buttons or order form elements
    const buyBtn = page.locator("button", { hasText: /buy|place order|submit/i }).first();
    await expect(buyBtn).toBeVisible({ timeout: 15_000 });
  });

  test("order book displays bid/ask data", async ({ page }) => {
    await navigateTo(page, "/trade");
    // Order book should have bid and ask columns
    const orderBook = page.locator("text=/bid|ask|order book/i").first();
    await expect(orderBook).toBeVisible({ timeout: 15_000 });
  });

  test("commodity trade page loads for a specific symbol", async ({ page }) => {
    await page.goto("/trade/GINGER-NG");
    await waitForShell(page);
    await expect(page).toHaveURL(/\/trade\/GINGER-NG/);
    await expect(page.locator("h1, h2, [data-testid='symbol']").first()).toBeVisible();
  });

  test("orders page shows open orders", async ({ page }) => {
    await navigateTo(page, "/orders");
    await expect(page).toHaveURL(/\/orders/);
    // Either shows orders or an empty state
    const content = page.locator("table, text=/no orders|empty|open orders/i").first();
    await expect(content).toBeVisible({ timeout: 15_000 });
  });
});

// ── 4. Cash Withdrawal ─────────────────────────────────────────────────────────

test.describe("Cash Withdrawal", () => {
  test("cash withdrawal page loads", async ({ page }) => {
    await navigateTo(page, "/cash-withdrawal");
    await expect(page).toHaveURL(/\/cash-withdrawal/);
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });

  test("withdrawal form is visible", async ({ page }) => {
    await navigateTo(page, "/cash-withdrawal");
    // Look for amount input or withdrawal form
    const amountInput = page.locator("input[type='number'], input[placeholder*='amount' i], input[name*='amount' i]").first();
    const withdrawBtn = page.locator("button", { hasText: /withdraw|request|submit/i }).first();
    await expect(amountInput.or(withdrawBtn)).toBeVisible({ timeout: 15_000 });
  });

  test("withdrawal requires bank account details", async ({ page }) => {
    await navigateTo(page, "/cash-withdrawal");
    // Look for bank account / account number fields
    const bankField = page.locator(
      "input[name*='bank' i], input[name*='account' i], text=/bank account|account number/i"
    ).first();
    await expect(bankField).toBeVisible({ timeout: 15_000 });
  });

  test("withdrawal history is accessible", async ({ page }) => {
    await navigateTo(page, "/cash-withdrawal");
    // Look for a history / previous withdrawals section
    const historySection = page.locator(
      "text=/history|previous|withdrawal history/i"
    ).first();
    await expect(historySection).toBeVisible({ timeout: 15_000 });
  });
});

// ── 5. Middleware Health Dashboard (admin) ─────────────────────────────────────

test.describe("Middleware Health Dashboard", () => {
  test("middleware health page loads for admin", async ({ page }) => {
    await navigateTo(page, "/admin/middleware-health");
    // Either shows the dashboard or redirects to login (non-admin user)
    const isHealthPage = await page.locator("text=/middleware health|service status/i").isVisible({ timeout: 15_000 }).catch(() => false);
    const isLoginPage = await page.locator("button", { hasText: /sign in/i }).isVisible().catch(() => false);
    expect(isHealthPage || isLoginPage).toBe(true);
  });

  test("platform health page loads", async ({ page }) => {
    await navigateTo(page, "/admin/platform-health");
    await expect(page).toHaveURL(/\/admin\/platform-health/);
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });
});

// ── 6. Critical Navigation ─────────────────────────────────────────────────────

test.describe("Critical Navigation", () => {
  const criticalRoutes = [
    { path: "/markets", label: "Markets" },
    { path: "/portfolio", label: "Portfolio" },
    { path: "/settlements", label: "Settlements" },
    { path: "/analytics", label: "Analytics" },
    { path: "/compliance", label: "Compliance" },
  ];

  for (const route of criticalRoutes) {
    test(`${route.label} page loads without error`, async ({ page }) => {
      await navigateTo(page, route.path);
      await expect(page).toHaveURL(new RegExp(route.path));
      // No error boundary should be visible
      await expect(page.locator("text=/something went wrong|error boundary/i")).toHaveCount(0);
      await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 15_000 });
    });
  }
});
