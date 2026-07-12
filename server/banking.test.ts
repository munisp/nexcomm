/**
 * Unit tests for bankingRouter
 * Uses vi.mock to isolate DB and audit dependencies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bankingRouter } from "./routers/bankingRouter";

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

vi.mock("./fluvio/fluvioClient", () => ({
  publishFluvioEvent: vi.fn().mockResolvedValue(undefined),
  FLUVIO_TOPICS: {
    LOAN_DISBURSED: "loan-disbursed",
    PAYMENT_RECEIVED: "payment-received",
    INSURANCE_APPLIED: "insurance-applied",
    FARMER_ONBOARDED: "farmer-onboarded",
    SYSTEM_EVENTS: "system-events",
  },
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

describe("bankingRouter", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("exports a router object", () => {
    expect(bankingRouter).toBeDefined();
    expect(typeof bankingRouter).toBe("object");
  });

  it("has getDashboard procedure", () => {
    expect(bankingRouter._def.record).toHaveProperty("getDashboard");
  });

  it("has listAccounts procedure", () => {
    expect(bankingRouter._def.record).toHaveProperty("listAccounts");
  });

  it("has getTransactions procedure", () => {
    expect(bankingRouter._def.record).toHaveProperty("getTransactions");
  });

  it("has listLoans procedure", () => {
    expect(bankingRouter._def.record).toHaveProperty("listLoans");
  });

  it("has getLoan procedure", () => {
    expect(bankingRouter._def.record).toHaveProperty("getLoan");
  });

  it("has applyLoan procedure", () => {
    expect(bankingRouter._def.record).toHaveProperty("applyLoan");
  });

  it("has applyForInsurance procedure", () => {
    expect(bankingRouter._def.record).toHaveProperty("applyForInsurance");
  });

  it("has listInsuranceApplications procedure", () => {
    expect(bankingRouter._def.record).toHaveProperty("listInsuranceApplications");
  });

  it("has getRepaymentSchedule procedure", () => {
    expect(bankingRouter._def.record).toHaveProperty("getRepaymentSchedule");
  });

  it("listLoans returns {loans, total} when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null);
    const proc = bankingRouter._def.record.listLoans as {
      _def: { resolver: (opts: { ctx: typeof userCtx; input: { limit: number; offset: number } }) => Promise<unknown> };
    };
    const result = await proc._def.resolver({ ctx: userCtx, input: { limit: 10, offset: 0 } }) as { loans: unknown[]; total: number };
    expect(Array.isArray(result.loans)).toBe(true);
    expect(result.total).toBe(0);
  });

  it("listInsuranceApplications returns empty array when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null);
    const proc = bankingRouter._def.record.listInsuranceApplications as {
      _def: { resolver: (opts: { ctx: typeof userCtx; input: { limit: number } }) => Promise<unknown> };
    };
    const result = await proc._def.resolver({ ctx: userCtx, input: { limit: 10 } });
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBe(0);
  });

  it("has at least 9 procedures", () => {
    const keys = Object.keys(bankingRouter._def.record);
    expect(keys.length).toBeGreaterThanOrEqual(9);
  });
});
