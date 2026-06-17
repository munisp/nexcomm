/**
 * Tests for profile.dashboard, profile.orderHistory, and search.aiSearch procedures.
 * These tests verify the router procedures exist, accept correct inputs, and
 * return the expected shape — without requiring a live database connection.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Shared mock context ───────────────────────────────────────────────────────
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createCtx(overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const user: AuthenticatedUser = {
    id: 42,
    openId: "test-open-id",
    email: "trader@nexcom.ng",
    name: "Test Trader",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ── profile.dashboard ─────────────────────────────────────────────────────────
describe("profile.dashboard", () => {
  it("procedure exists on the router", () => {
    expect(appRouter._def.procedures["profile.dashboard"]).toBeDefined();
  });

  it("returns null when database is unavailable (getDb returns null)", async () => {
    // Mock getDb to return null to simulate no-DB environment
    vi.mock("./db", () => ({ getDb: async () => null }));
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.profile.dashboard();
    // Should return null gracefully
    expect(result).toBeNull();
    vi.restoreAllMocks();
  });
});

// ── profile.orderHistory ──────────────────────────────────────────────────────
describe("profile.orderHistory", () => {
  it("procedure exists on the router", () => {
    expect(appRouter._def.procedures["profile.orderHistory"]).toBeDefined();
  });

  it("rejects invalid page values", async () => {
    const caller = appRouter.createCaller(createCtx());
    await expect(
      // @ts-expect-error intentionally passing invalid input
      caller.profile.orderHistory({ page: 0, pageSize: 20 })
    ).rejects.toThrow();
  });

  it("rejects pageSize above maximum (100)", async () => {
    const caller = appRouter.createCaller(createCtx());
    await expect(
      // @ts-expect-error intentionally passing invalid input
      caller.profile.orderHistory({ page: 1, pageSize: 200 })
    ).rejects.toThrow();
  });

  it("returns empty result set when database is unavailable", async () => {
    vi.mock("./db", () => ({ getDb: async () => null }));
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.profile.orderHistory({ page: 1, pageSize: 20 });
    expect(result).toMatchObject({ items: [], total: 0, page: 1, pageSize: 20 });
    vi.restoreAllMocks();
  });
});

// ── search.aiSearch ───────────────────────────────────────────────────────────
describe("search.aiSearch", () => {
  it("procedure exists on the router", () => {
    // tRPC v11 stores procedures as functions in _def.procedures
    expect(appRouter._def.procedures["search.aiSearch"]).toBeDefined();
  });

  it("rejects empty query string", async () => {
    const caller = appRouter.createCaller(createCtx());
    await expect(
      // @ts-expect-error intentionally passing invalid input
      caller.search.aiSearch({ query: "" })
    ).rejects.toThrow();
  });

  it("rejects query longer than 500 characters", async () => {
    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.search.aiSearch({ query: "a".repeat(501) })
    ).rejects.toThrow();
  });

  it("returns empty results when database is unavailable", async () => {
    vi.mock("./db", () => ({ getDb: async () => null }));
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.search.aiSearch({ query: "my open maize orders" });
    expect(result).toMatchObject({ results: [] });
    vi.restoreAllMocks();
  });
});

// ── useExchangeToasts hook (unit test for toast helpers) ──────────────────────
describe("useExchangeToasts helpers", () => {
  it("exports all expected toast functions", async () => {
    const mod = await import("../client/src/hooks/useExchangeToasts");
    expect(typeof mod.toastOrderPlaced).toBe("function");
    expect(typeof mod.toastOrderFilled).toBe("function");
    expect(typeof mod.toastOrderCancelled).toBe("function");
    expect(typeof mod.toastOrderRejected).toBe("function");
    expect(typeof mod.toastProfileSaved).toBe("function");
    expect(typeof mod.toastProfileError).toBe("function");
    expect(typeof mod.toastSearchError).toBe("function");
    expect(typeof mod.useExchangeToasts).toBe("function");
  });
});
