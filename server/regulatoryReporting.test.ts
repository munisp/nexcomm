/**
 * Unit tests for regulatoryReportingRouter
 * Uses vi.mock to isolate DB and notification dependencies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { regulatoryReportingRouter } from "./routers/regulatoryReportingRouter";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("../_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

vi.mock("./audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminCtx = {
  user: { id: 1, role: "admin" as const, email: "admin@nexcom.io", name: "Admin" },
  req: {} as never,
  res: {} as never,
};

function callProcedure<T>(
  procedure: { _def: { resolver: (opts: { ctx: typeof adminCtx; input: T }) => Promise<unknown> } },
  input: T,
  ctx = adminCtx
) {
  return procedure._def.resolver({ ctx, input });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("regulatoryReportingRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports a router object with expected procedures", () => {
    expect(regulatoryReportingRouter).toBeDefined();
    expect(typeof regulatoryReportingRouter).toBe("object");
  });

  it("has adminGenerateReport procedure", () => {
    expect(regulatoryReportingRouter._def.record).toHaveProperty("adminGenerateReport");
  });

  it("has adminListReports procedure", () => {
    expect(regulatoryReportingRouter._def.record).toHaveProperty("adminListReports");
  });

  it("has adminDownloadReport procedure", () => {
    expect(regulatoryReportingRouter._def.record).toHaveProperty("adminDownloadReport");
  });

  it("has adminDeleteReport procedure", () => {
    expect(regulatoryReportingRouter._def.record).toHaveProperty("adminDeleteReport");
  });

  it("has adminGetReportStats procedure", () => {
    expect(regulatoryReportingRouter._def.record).toHaveProperty("adminGetReportStats");
  });

  it("has adminCreateSchedule procedure", () => {
    expect(regulatoryReportingRouter._def.record).toHaveProperty("adminCreateSchedule");
  });

  it("has adminListSchedules procedure", () => {
    expect(regulatoryReportingRouter._def.record).toHaveProperty("adminListSchedules");
  });

  it("has myReports procedure", () => {
    expect(regulatoryReportingRouter._def.record).toHaveProperty("myReports");
  });

  it("adminListReports throws TRPCError when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null);
    const proc = regulatoryReportingRouter._def.record.adminListReports as {
      _def: { resolver: (opts: { ctx: typeof adminCtx; input: { limit: number; offset: number } }) => Promise<unknown> };
    };
    await expect(proc._def.resolver({ ctx: adminCtx, input: { limit: 10, offset: 0 } })).rejects.toThrow();
  });

  it("adminListSchedules throws TRPCError when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null);
    const proc = regulatoryReportingRouter._def.record.adminListSchedules as {
      _def: { resolver: (opts: { ctx: typeof adminCtx; input: Record<string, never> }) => Promise<unknown> };
    };
    await expect(proc._def.resolver({ ctx: adminCtx, input: {} })).rejects.toThrow();
  });

  it("has at least 8 procedures", () => {
    const keys = Object.keys(regulatoryReportingRouter._def.record);
    expect(keys.length).toBeGreaterThanOrEqual(8);
  });
});
