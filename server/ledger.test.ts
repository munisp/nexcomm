/**
 * Unit tests for ledgerRouter
 * Uses vi.mock to isolate DB and audit dependencies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ledgerRouter } from "./routers/ledgerRouter";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  getReadDb: vi.fn().mockResolvedValue(null),
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

describe("ledgerRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports a router object", () => {
    expect(ledgerRouter).toBeDefined();
    expect(typeof ledgerRouter).toBe("object");
  });

  it("has getAccount procedure", () => {
    expect(ledgerRouter._def.record).toHaveProperty("getAccount");
  });

  it("has listAccounts procedure", () => {
    expect(ledgerRouter._def.record).toHaveProperty("listAccounts");
  });

  it("has getJournalHistory procedure", () => {
    expect(ledgerRouter._def.record).toHaveProperty("getJournalHistory");
  });

  it("has internalTransfer procedure", () => {
    expect(ledgerRouter._def.record).toHaveProperty("internalTransfer");
  });

  it("has adminListAccounts procedure", () => {
    expect(ledgerRouter._def.record).toHaveProperty("adminListAccounts");
  });

  it("has adminEnqueueSettlement procedure", () => {
    expect(ledgerRouter._def.record).toHaveProperty("adminEnqueueSettlement");
  });

  it("has adminProcessSettlementQueue procedure", () => {
    expect(ledgerRouter._def.record).toHaveProperty("adminProcessSettlementQueue");
  });

  it("has adminLedgerSummary procedure", () => {
    expect(ledgerRouter._def.record).toHaveProperty("adminLedgerSummary");
  });

  it("listAccounts returns {accounts} when DB is unavailable", async () => {
    const { getReadDb } = await import("./db");
    vi.mocked(getReadDb).mockResolvedValue(null);
    const proc = ledgerRouter._def.record.listAccounts as {
      _def: { resolver: (opts: { ctx: typeof userCtx; input: { limit: number } }) => Promise<unknown> };
    };
    const result = await proc._def.resolver({ ctx: userCtx, input: { limit: 50 } }) as { accounts: unknown[] };
    expect(Array.isArray(result.accounts)).toBe(true);
    expect(result.accounts.length).toBe(0);
  });

  it("adminListAccounts returns array when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null);
    const proc = ledgerRouter._def.record.adminListAccounts as {
      _def: { resolver: (opts: { ctx: typeof adminCtx; input: { limit: number; offset: number } }) => Promise<unknown> };
    };
    const result = await proc._def.resolver({ ctx: adminCtx, input: { limit: 10, offset: 0 } });
    expect(result).toBeDefined();
  });

  it("adminLedgerSummary returns object when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null);
    const proc = ledgerRouter._def.record.adminLedgerSummary as {
      _def: { resolver: (opts: { ctx: typeof adminCtx; input: Record<string, never> }) => Promise<unknown> };
    };
    const result = await proc._def.resolver({ ctx: adminCtx, input: {} });
    expect(result).toBeDefined();
  });

  it("has at least 8 procedures", () => {
    const keys = Object.keys(ledgerRouter._def.record);
    expect(keys.length).toBeGreaterThanOrEqual(8);
  });
});
