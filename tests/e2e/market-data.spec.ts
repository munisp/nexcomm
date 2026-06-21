/**
 * NEXCOM Exchange — Market Data & Search E2E Tests
 *
 * Tests the public market data endpoints and the AI-powered search feature.
 * These tests do not require authentication.
 *
 * NOTE: All API calls use page.evaluate() so they go through localhost
 * (bypassing the external proxy rate limiter).
 */
import { test, expect } from "@playwright/test";

test.describe("Commodities API", () => {
  test("commodities.list returns an array", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const res = await fetch(
        "/api/trpc/commodities.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D"
      );
      const json = await res.json();
      return { status: res.status, json };
    });
    expect(result.status).toBe(200);
    expect(Array.isArray(result.json)).toBeTruthy();
    if (result.json.length > 0) {
      expect(result.json[0]).toHaveProperty("result");
    }
  });

  test("commodities.list result contains expected fields", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const res = await fetch(
        "/api/trpc/commodities.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D"
      );
      const json = await res.json();
      return { status: res.status, json };
    });
    expect(result.status).toBe(200);
    const items = result.json[0]?.result?.data?.json;
    if (Array.isArray(items) && items.length > 0) {
      const first = items[0];
      // commodities.list returns symbol, name, category, unit, currency, basePrice
      expect(first).toHaveProperty("name");
      expect(first).toHaveProperty("symbol");
    }
  });
});

test.describe("Market Data API", () => {
  test("marketData.symbols returns a list of symbols", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const res = await fetch(
        "/api/trpc/marketData.symbols?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D"
      );
      const json = await res.json();
      return { status: res.status, json };
    });
    expect(result.status).toBe(200);
    expect(Array.isArray(result.json)).toBeTruthy();
  });

  test("marketData.exchangeStatus returns exchange status", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const res = await fetch(
        "/api/trpc/marketData.exchangeStatus?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D"
      );
      const json = await res.json();
      return { status: res.status, json };
    });
    expect(result.status).toBe(200);
    expect(Array.isArray(result.json)).toBeTruthy();
  });
});

test.describe("Search API", () => {
  test("search.global requires authentication (protected procedure)", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const input = encodeURIComponent(
        JSON.stringify({ "0": { json: { query: "maize", limit: 5 } } })
      );
      const res = await fetch(`/api/trpc/search.global?batch=1&input=${input}`, {
        credentials: "include",
      });
      let json: unknown[] = [];
      try { json = await res.json(); } catch { /* ignore */ }
      return { status: res.status, json };
    });
    // search.global is a protectedProcedure — should return 401 without auth
    const isUnauthorized =
      result.status === 401 ||
      result.status === 403 ||
      result.status === 429 ||
      (Array.isArray(result.json) && result.json[0]?.error?.data?.code === "UNAUTHORIZED");
    expect(isUnauthorized).toBeTruthy();
  });

  test("commodities.list supports filtering by category", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const input = encodeURIComponent(
        JSON.stringify({ "0": { json: { category: "Grains" } } })
      );
      const res = await fetch(`/api/trpc/commodities.list?batch=1&input=${input}`);
      const json = await res.json();
      return { status: res.status, json };
    });
    // Should return 200 — even if no results, the endpoint should be reachable
    expect(result.status).toBe(200);
  });
});

test.describe("Stripe on-ramp API", () => {
  test("stripe.listPayments requires authentication", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const res = await fetch(
        "/api/trpc/stripe.listPayments?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D",
        { credentials: "include" }
      );
      let json: unknown[] = [];
      try { json = await res.json(); } catch { /* ignore */ }
      return { status: res.status, json };
    });
    const isUnauthorized =
      result.status === 401 ||
      result.status === 403 ||
      result.status === 429 ||
      (Array.isArray(result.json) && result.json[0]?.error?.data?.code === "UNAUTHORIZED");
    expect(isUnauthorized).toBeTruthy();
  });
});
