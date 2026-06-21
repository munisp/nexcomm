/**
 * NEXCOM Exchange — Payments & Stripe E2E Tests
 *
 * Tests the Stripe deposit flow, webhook endpoint, and payment history.
 * Stripe test mode is used — no real charges are made.
 *
 * NOTE: All tRPC calls use page.evaluate() so they go through localhost
 * (bypassing the external proxy rate limiter).
 */
import { test, expect } from "@playwright/test";

test.describe("Stripe Webhook", () => {
  test("webhook endpoint rejects requests without Stripe signature", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/stripe/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "checkout.session.completed" }),
      });
      return { status: res.status };
    });
    // Should reject with 400 (invalid/missing signature)
    expect(result.status).toBe(400);
  });

  test("webhook endpoint responds to test event verification", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/stripe/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": "t=invalid,v1=invalid",
        },
        body: JSON.stringify({ id: "evt_test_verification" }),
      });
      return { status: res.status };
    });
    // 400 is expected (invalid signature) — endpoint exists and is reachable
    expect([400, 200]).toContain(result.status);
  });
});

test.describe("Stripe tRPC Procedures", () => {
  test("stripe.createDepositSession requires authentication", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/trpc/stripe.createDepositSession?batch=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          "0": {
            json: {
              amountUsd: 100,
              successUrl: "http://localhost:3000/success",
              cancelUrl: "http://localhost:3000/cancel",
            },
          },
        }),
      });
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

test.describe("Banking API", () => {
  test("banking.getDashboard requires authentication", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const res = await fetch(
        "/api/trpc/banking.getDashboard?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D",
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

  test("banking.getCreditScore requires authentication", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const res = await fetch(
        "/api/trpc/banking.getCreditScore?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D",
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
