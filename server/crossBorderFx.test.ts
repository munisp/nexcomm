/**
 * crossBorderFx.test.ts — Unit tests for crossBorderFxRouter
 * Uses structural inspection (no proc.resolve calls) consistent with other router tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock heavy dependencies ──────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));
vi.mock("./temporal/temporalClient", () => ({
  triggerTemporalWorkflow: vi.fn().mockResolvedValue("xborder-test-wf-001"),
  queryTemporalWorkflow: vi.fn().mockResolvedValue(null),
  cancelTemporalWorkflow: vi.fn().mockResolvedValue(true),
}));
vi.mock("./fluvio/fluvioClient", () => ({
  publishFluvioEvent: vi.fn().mockResolvedValue(true),
  FLUVIO_TOPICS: {
    CROSS_BORDER_TRANSFERS: "cross-border-transfers",
    SYSTEM_EVENTS: "system-events",
    ORDER_EVENTS: "order-events",
    TRADE_EVENTS: "trade-events",
    MARKET_DATA: "market-data",
    ORDER_BOOK_UPDATES: "order-book-updates",
  },
}));
vi.mock("./audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));
vi.mock("./permify", () => ({
  checkPermission: vi.fn().mockResolvedValue(true),
}));

// ── Import router after mocks ─────────────────────────────────────────────────
import { crossBorderFxRouter } from "./routers/crossBorderFxRouter";

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("crossBorderFxRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports the crossBorderFxRouter object", () => {
    expect(crossBorderFxRouter).toBeDefined();
    expect(typeof crossBorderFxRouter).toBe("object");
  });

  it("has all expected procedures", () => {
    const procedures = Object.keys(crossBorderFxRouter);
    expect(procedures).toContain("initiate");
    expect(procedures).toContain("getStatus");
    expect(procedures).toContain("cancel");
    expect(procedures).toContain("list");
    expect(procedures).toContain("adminList");
    expect(procedures).toContain("adminNotifyFailure");
    expect(procedures.length).toBeGreaterThanOrEqual(6);
  });

  it("initiate procedure is defined and callable", () => {
    expect(crossBorderFxRouter.initiate).toBeDefined();
    expect(["function", "object"]).toContain(typeof crossBorderFxRouter.initiate);
  });

  it("getStatus procedure is defined and callable", () => {
    expect(crossBorderFxRouter.getStatus).toBeDefined();
    expect(["function", "object"]).toContain(typeof crossBorderFxRouter.getStatus);
  });

  it("cancel procedure is defined and callable", () => {
    expect(crossBorderFxRouter.cancel).toBeDefined();
    expect(["function", "object"]).toContain(typeof crossBorderFxRouter.cancel);
  });

  it("list procedure is defined and callable", () => {
    expect(crossBorderFxRouter.list).toBeDefined();
    expect(["function", "object"]).toContain(typeof crossBorderFxRouter.list);
  });

  it("adminList procedure is defined and callable", () => {
    expect(crossBorderFxRouter.adminList).toBeDefined();
    expect(["function", "object"]).toContain(typeof crossBorderFxRouter.adminList);
  });

  it("adminNotifyFailure procedure is defined and callable", () => {
    expect(crossBorderFxRouter.adminNotifyFailure).toBeDefined();
    expect(["function", "object"]).toContain(typeof crossBorderFxRouter.adminNotifyFailure);
  });

  it("initiate procedure is a mutation (not a query)", () => {
    const proc = crossBorderFxRouter.initiate as { _def: { type: string } };
    expect(proc._def.type).toBe("mutation");
  });

  it("getStatus procedure is a query (not a mutation)", () => {
    const proc = crossBorderFxRouter.getStatus as { _def: { type: string } };
    expect(proc._def.type).toBe("query");
  });

  it("list procedure is a query (not a mutation)", () => {
    const proc = crossBorderFxRouter.list as { _def: { type: string } };
    expect(proc._def.type).toBe("query");
  });

  it("cancel procedure is a mutation (not a query)", () => {
    const proc = crossBorderFxRouter.cancel as { _def: { type: string } };
    expect(proc._def.type).toBe("mutation");
  });

  it("adminList procedure is a query (not a mutation)", () => {
    const proc = crossBorderFxRouter.adminList as { _def: { type: string } };
    expect(proc._def.type).toBe("query");
  });

  it("crossBorderFxRouter is a valid tRPC router with _def", () => {
    expect(crossBorderFxRouter).toHaveProperty("_def");
  });

  it("all procedures are valid tRPC procedure objects", () => {
    for (const [key, proc] of Object.entries(crossBorderFxRouter)) {
      expect(proc, `${key} should be defined`).toBeDefined();
      expect(["function", "object"]).toContain(typeof proc);
    }
  });
});
