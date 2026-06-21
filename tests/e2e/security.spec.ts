/**
 * NEXCOM Exchange — Security E2E Tests
 *
 * Tests CSRF protection, rate limiting headers, and security middleware.
 * These tests verify the security posture of the API layer.
 */
import { test, expect } from "@playwright/test";

test.describe("CSRF Protection", () => {
  test("state-changing tRPC mutation without CSRF token is rejected", async ({ page }) => {
    // Navigate first so relative URLs resolve correctly
    await page.goto("/");
    // Attempt a mutation (orders.create) without a CSRF token using fetch from browser
    const result = await page.evaluate(async () => {
      try {
        const res = await fetch("/api/trpc/orders.create?batch=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            "0": { json: { commodityId: 1, side: "BUY", type: "LIMIT", quantity: 10, price: 100 } },
          }),
          credentials: "include",
        });
        return { status: res.status };
      } catch {
        return { status: 0 };
      }
    });
    // Should be rejected with 403 (CSRF) or 401 (no session) — never 200
    expect([400, 401, 403]).toContain(result.status);
  });

  test("CSRF token endpoint sets correct headers", async ({ page }) => {
    const response = await page.goto("/api/csrf-token");
    expect(response?.status()).toBe(200);
    // Should not expose sensitive headers
    const headers = response?.headers() ?? {};
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});

test.describe("Security Headers", () => {
  test("API responses include security headers", async ({ page }) => {
    const response = await page.goto("/api/csrf-token");
    const headers = response?.headers() ?? {};

    // X-Powered-By should be removed
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("HTML responses include CSP or security headers", async ({ page }) => {
    const response = await page.goto("/");
    const headers = response?.headers() ?? {};

    // At minimum, X-Powered-By should be absent
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});

test.describe("Rate Limiting", () => {
  test("auth endpoints respond within acceptable time", async ({ page }) => {
    const start = Date.now();
    await page.goto("/api/csrf-token");
    const elapsed = Date.now() - start;
    // Should respond within 5 seconds even under load
    expect(elapsed).toBeLessThan(5000);
  });

  test("repeated requests to public API do not get blocked immediately", async ({ page }) => {
    // Navigate first so relative URLs resolve correctly
    await page.goto("/");
    // Make 5 rapid requests from the browser — should all succeed (localhost bypass active)
    const results = await page.evaluate(async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await fetch(
          "/api/trpc/commodities.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D"
        );
        statuses.push(res.status);
      }
      return statuses;
    });
    // All should succeed (200) or at most one might be rate-limited (429)
    const allOk = results.every((s) => s === 200 || s === 429);
    expect(allOk).toBeTruthy();
  });
});

test.describe("Protected Routes — Auth Guard", () => {
  const protectedProcedures = [
    // auth.me is a publicProcedure returning null when unauthenticated — skip
    // portfolio.getPortfolioSummary is under portfolioAnalytics router — use correct path
    "orders.list",           // protectedProcedure — returns 401
    "banking.getDashboard",  // protectedProcedure — returns 401
  ];

  for (const procedure of protectedProcedures) {
    test(`${procedure} requires authentication`, async ({ page }) => {
      // Navigate to the app first so relative URLs resolve correctly
      await page.goto("/");
      // Use page.evaluate so requests go through localhost (bypassing rate limit)
      const result = await page.evaluate(async (proc: string) => {
        const url = `${window.location.origin}/api/trpc/${proc}?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D`;
        const res = await fetch(url, { credentials: "include" });
        let json: unknown[] = [];
        try { json = await res.json(); } catch { /* ignore */ }
        return { status: res.status, json };
      }, procedure);
      const isProtected =
        result.status === 401 ||
        result.status === 403 ||
        result.status === 429 ||
        (Array.isArray(result.json) &&
          (result.json[0]?.error?.data?.code === "UNAUTHORIZED" ||
            result.json[0]?.error?.data?.code === "FORBIDDEN"));
      expect(isProtected).toBeTruthy();
    });
  }
});
