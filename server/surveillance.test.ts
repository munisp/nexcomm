/**
 * Unit tests for surveillanceRouter
 * Uses vi.mock to isolate DB and audit dependencies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { surveillanceRouter } from "./routers/surveillanceRouter";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("./audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminCtx = {
  user: { id: 1, role: "admin" as const, email: "admin@nexcom.io", name: "Admin" },
  req: {} as never,
  res: {} as never,
};

const userCtx = {
  user: { id: 42, role: "user" as const, email: "user@nexcom.io", name: "User" },
  req: {} as never,
  res: {} as never,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("surveillanceRouter", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("exports a router object", () => {
    expect(surveillanceRouter).toBeDefined();
    expect(typeof surveillanceRouter).toBe("object");
  });

  it("has adminCreateCircuitBreakerRule procedure", () => {
    expect(surveillanceRouter._def.record).toHaveProperty("adminCreateCircuitBreakerRule");
  });

  it("has adminListCircuitBreakerRules procedure", () => {
    expect(surveillanceRouter._def.record).toHaveProperty("adminListCircuitBreakerRules");
  });

  it("has adminUpdateCircuitBreakerRule procedure", () => {
    expect(surveillanceRouter._def.record).toHaveProperty("adminUpdateCircuitBreakerRule");
  });

  it("has adminDeleteCircuitBreakerRule procedure", () => {
    expect(surveillanceRouter._def.record).toHaveProperty("adminDeleteCircuitBreakerRule");
  });

  it("has checkCircuitBreaker procedure", () => {
    expect(surveillanceRouter._def.record).toHaveProperty("checkCircuitBreaker");
  });

  it("has adminListCircuitBreakerEvents procedure", () => {
    expect(surveillanceRouter._def.record).toHaveProperty("adminListCircuitBreakerEvents");
  });

  it("has adminGetHaltedInstruments procedure", () => {
    expect(surveillanceRouter._def.record).toHaveProperty("adminGetHaltedInstruments");
  });

  it("has adminLiftHalt procedure", () => {
    expect(surveillanceRouter._def.record).toHaveProperty("adminLiftHalt");
  });

  it("has adminTriggerCircuitBreaker procedure", () => {
    expect(surveillanceRouter._def.record).toHaveProperty("adminTriggerCircuitBreaker");
  });

  it("adminListCircuitBreakerRules throws TRPCError when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null);
    const proc = surveillanceRouter._def.record.adminListCircuitBreakerRules as {
      _def: { resolver: (opts: { ctx: typeof adminCtx; input: Record<string, never> }) => Promise<unknown> };
    };
    await expect(proc._def.resolver({ ctx: adminCtx, input: {} })).rejects.toThrow();
  });

  it("adminGetHaltedInstruments throws TRPCError when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null);
    const proc = surveillanceRouter._def.record.adminGetHaltedInstruments as {
      _def: { resolver: (opts: { ctx: typeof adminCtx; input: Record<string, never> }) => Promise<unknown> };
    };
    await expect(proc._def.resolver({ ctx: adminCtx, input: {} })).rejects.toThrow();
  });

  it("has at least 10 procedures", () => {
    const keys = Object.keys(surveillanceRouter._def.record);
    expect(keys.length).toBeGreaterThanOrEqual(10);
  });
});
