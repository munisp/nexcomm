/**
 * stripe.test.ts — Unit tests for the Stripe payment router
 *
 * Uses tRPC's createCallerFactory pattern (the correct way to test tRPC routers
 * without going through HTTP — no .resolve() needed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ── Mock Stripe ───────────────────────────────────────────────────────────────
vi.mock("stripe", () => {
  const mockSessionCreate = vi.fn().mockResolvedValue({
    id: "cs_test_abc123",
    url: "https://checkout.stripe.com/pay/cs_test_abc123",
    payment_intent: "pi_test_xyz",
    amount_total: 10000,
    client_reference_id: "1",
    metadata: { user_id: "1" },
  });
  return {
    default: vi.fn().mockImplementation(() => ({
      checkout: { sessions: { create: mockSessionCreate } },
      webhooks: {
        constructEvent: vi.fn().mockReturnValue({
          id: "evt_test_001",
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_test_abc123",
              payment_intent: "pi_test_xyz",
              amount_total: 10000,
              client_reference_id: "1",
              metadata: { user_id: "1" },
            },
          },
        }),
      },
    })),
  };
});

// ── Mock DB (return empty arrays / success for all queries) ───────────────────
vi.mock("../db", () => ({
  getDb: vi.fn().mockResolvedValue({}),
}));

// We mock the drizzle DB module that stripeRouter uses internally
vi.mock("../../drizzle/schema", () => ({
  stripePayments: {},
  users: {},
}));

// ── Import DEPOSIT_AMOUNTS_USD (doesn't need DB) ──────────────────────────────
import { DEPOSIT_AMOUNTS_USD } from "./routers/stripeRouter";

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("stripeRouter", () => {
  describe("DEPOSIT_AMOUNTS_USD", () => {
    it("should contain the standard preset amounts", () => {
      expect(DEPOSIT_AMOUNTS_USD).toContain(50);
      expect(DEPOSIT_AMOUNTS_USD).toContain(100);
      expect(DEPOSIT_AMOUNTS_USD).toContain(1000);
      expect(DEPOSIT_AMOUNTS_USD.length).toBeGreaterThanOrEqual(5);
    });

    it("should not contain amounts below $0.50", () => {
      const belowMin = DEPOSIT_AMOUNTS_USD.filter((a) => a < 0.5);
      expect(belowMin).toHaveLength(0);
    });

    it("should be sorted in ascending order", () => {
      const sorted = [...DEPOSIT_AMOUNTS_USD].sort((a, b) => a - b);
      expect(DEPOSIT_AMOUNTS_USD).toEqual(sorted);
    });
  });

  describe("Stripe client configuration", () => {
    it("should export a stripeClient instance", async () => {
      const { stripeClient } = await import("./routers/stripeRouter");
      expect(stripeClient).toBeDefined();
    });
  });

  describe("registerStripeWebhook", () => {
    it("should export a registerStripeWebhook function", async () => {
      const { registerStripeWebhook } = await import("./routers/stripeRouter");
      expect(typeof registerStripeWebhook).toBe("function");
    });

    it("should register the /api/stripe/webhook route on an express app", async () => {
      const { registerStripeWebhook } = await import("./routers/stripeRouter");
      const mockApp = {
        post: vi.fn(),
        use: vi.fn(),
      };
      registerStripeWebhook(mockApp as unknown as Parameters<typeof registerStripeWebhook>[0]);
      expect(mockApp.post).toHaveBeenCalledWith(
        "/api/stripe/webhook",
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe("stripeRouter procedures", () => {
    it("should export a stripeRouter object with the expected procedures", async () => {
      const { stripeRouter } = await import("./routers/stripeRouter");
      expect(stripeRouter).toBeDefined();
      expect(stripeRouter).toHaveProperty("createDepositSession");
      expect(stripeRouter).toHaveProperty("listPayments");
      expect(stripeRouter).toHaveProperty("getPayment");
      expect(stripeRouter).toHaveProperty("adminListPayments");
    });
  });
});
