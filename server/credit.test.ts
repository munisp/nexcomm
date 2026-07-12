/**
 * Unit tests for creditRouter
 * Uses vi.mock to isolate DB and external service dependencies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { creditRouter } from "./routers/creditRouter";

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

const userCtx = {
  user: { id: 42, role: "user" as const, email: "user@nexcom.io", name: "User" },
  req: {} as never,
  res: {} as never,
};

const adminCtx = {
  user: { id: 1, role: "admin" as const, email: "admin@nexcom.io", name: "Admin" },
  req: {} as never,
  res: {} as never,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("creditRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports a router object", () => {
    expect(creditRouter).toBeDefined();
    expect(typeof creditRouter).toBe("object");
  });

  it("has getMyScore procedure", () => {
    expect(creditRouter._def.record).toHaveProperty("getMyScore");
  });

  it("has getScoreHistory procedure", () => {
    expect(creditRouter._def.record).toHaveProperty("getScoreHistory");
  });

  it("has adminGetScore procedure", () => {
    expect(creditRouter._def.record).toHaveProperty("adminGetScore");
  });

  it("has adminCreateScore procedure", () => {
    expect(creditRouter._def.record).toHaveProperty("adminCreateScore");
  });

  it("has adminListScores procedure", () => {
    expect(creditRouter._def.record).toHaveProperty("adminListScores");
  });

  it("has listMyCollateral procedure", () => {
    expect(creditRouter._def.record).toHaveProperty("listMyCollateral");
  });

  it("has registerCollateral procedure", () => {
    expect(creditRouter._def.record).toHaveProperty("registerCollateral");
  });

  it("getMyScore returns null when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null);
    const proc = creditRouter._def.record.getMyScore as {
      _def: { resolver: (opts: { ctx: typeof userCtx; input: Record<string, never> }) => Promise<unknown> };
    };
    const result = await proc._def.resolver({ ctx: userCtx, input: {} });
    expect(result).toBeNull();
  });

  it("listMyCollateral returns empty array when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null);
    const proc = creditRouter._def.record.listMyCollateral as {
      _def: { resolver: (opts: { ctx: typeof userCtx; input: Record<string, never> }) => Promise<unknown> };
    };
    const result = await proc._def.resolver({ ctx: userCtx, input: {} });
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBe(0);
  });

  it("adminListScores returns {scores, total} when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null);
    const proc = creditRouter._def.record.adminListScores as {
      _def: { resolver: (opts: { ctx: typeof adminCtx; input: { limit: number; offset: number } }) => Promise<unknown> };
    };
    const result = await proc._def.resolver({ ctx: adminCtx, input: { limit: 10, offset: 0 } }) as { scores: unknown[]; total: number };
    expect(Array.isArray(result.scores)).toBe(true);
    expect(result.total).toBe(0);
  });

  it("has at least 10 procedures", () => {
    const keys = Object.keys(creditRouter._def.record);
    expect(keys.length).toBeGreaterThanOrEqual(10);
  });
});
