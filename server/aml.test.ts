/**
 * Unit tests for amlRouter
 * Uses vi.mock to isolate DB, permify, and audit dependencies.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { amlRouter } from "./routers/amlRouter";
import { _resetStorageClient } from "./storage";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("./audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../_core/permify", () => ({
  requireAmlEscalate: vi.fn().mockResolvedValue(undefined),
  requireExchangeAdmin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://s3.example.com/test.csv", key: "test.csv" }),
  _resetStorageClient: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminCtx = {
  user: { id: 1, role: "admin" as const, email: "admin@nexcom.io", name: "Admin" },
  req: {} as never,
  res: {} as never,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("amlRouter", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterAll(() => { _resetStorageClient(); });

  it("exports a router object", () => {
    expect(amlRouter).toBeDefined();
    expect(typeof amlRouter).toBe("object");
  });

  it("has adminListRules procedure", () => {
    expect(amlRouter._def.record).toHaveProperty("adminListRules");
  });

  it("has adminCreateRule procedure", () => {
    expect(amlRouter._def.record).toHaveProperty("adminCreateRule");
  });

  it("has adminListFlags procedure", () => {
    expect(amlRouter._def.record).toHaveProperty("adminListFlags");
  });

  it("has adminReviewFlag procedure", () => {
    expect(amlRouter._def.record).toHaveProperty("adminReviewFlag");
  });

  it("has adminListSARs procedure", () => {
    expect(amlRouter._def.record).toHaveProperty("adminListSARs");
  });

  it("has adminCreateSAR procedure", () => {
    expect(amlRouter._def.record).toHaveProperty("adminCreateSAR");
  });

  it("has adminGenerateExport procedure", () => {
    expect(amlRouter._def.record).toHaveProperty("adminGenerateExport");
  });

  it("has getDashboardStats procedure", () => {
    expect(amlRouter._def.record).toHaveProperty("getDashboardStats");
  });

  it("has myFlags procedure", () => {
    expect(amlRouter._def.record).toHaveProperty("myFlags");
  });

  it("adminListRules returns array when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null);
    const proc = amlRouter._def.record.adminListRules as {
      _def: { resolver: (opts: { ctx: typeof adminCtx; input: Record<string, never> }) => Promise<unknown> };
    };
    const result = await proc._def.resolver({ ctx: adminCtx, input: {} });
    expect(Array.isArray(result)).toBe(true);
  });

  it("adminListFlags returns {flags, total} when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null);
    const proc = amlRouter._def.record.adminListFlags as {
      _def: { resolver: (opts: { ctx: typeof adminCtx; input: { status: string; severity: string; limit: number; offset: number } }) => Promise<unknown> };
    };
    const result = await proc._def.resolver({ ctx: adminCtx, input: { status: "ALL", severity: "ALL", limit: 10, offset: 0 } }) as { flags: unknown[]; total: number };
    expect(Array.isArray(result.flags)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("has at least 12 procedures", () => {
    const keys = Object.keys(amlRouter._def.record);
    expect(keys.length).toBeGreaterThanOrEqual(12);
  });
});
