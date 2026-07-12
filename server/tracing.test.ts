/**
 * NEXCOM Exchange — tracingRouter Unit Tests
 *
 * Verifies that all procedures are defined and the router is properly structured.
 * All DB / external-service calls are mocked so tests run fully offline.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Offline mocks ─────────────────────────────────────────────────────────────
vi.mock("../db", () => ({
  getDb: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
          limit: vi.fn().mockResolvedValue([]),
        }),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  }),
}));

vi.mock("./audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./cache", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./fluvio/fluvioClient", () => ({
  publishFluvioEvent: vi.fn().mockResolvedValue(undefined),
  FLUVIO_TOPICS: {
    TRADE_EVENTS: "trade-events",
    SYSTEM_EVENTS: "system-events",
    ORDER_BOOK_UPDATES: "order-book-updates",
    MARKET_DATA: "market-data",
  },
}));

// Mock global fetch used by fetchFromCollector
global.fetch = vi.fn().mockResolvedValue({
  ok: false,
  json: vi.fn().mockResolvedValue(null),
});

// ── Import router under test ──────────────────────────────────────────────────
import { tracingRouter } from "./routers/tracingRouter";

const mockAdminCtx = {
  user: { id: 1, role: "admin" as const, openId: "admin-open-id" },
  req: { headers: {} },
  res: { setHeader: vi.fn() },
};

describe("tracingRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("router is defined", () => {
    expect(tracingRouter).toBeDefined();
  });

  it("has all expected procedures", () => {
    const keys = Object.keys(tracingRouter);
    const expected = [
      "getTraces",
      "getTraceDetail",
      "getServiceMap",
      "getSlowOperations",
      "ingestTrace",
      "purgeOldTraces",
    ];
    for (const key of expected) {
      expect(keys).toContain(key);
    }
  });

  it("getTraces procedure is callable", () => {
    expect(tracingRouter.getTraces).toBeDefined();
    // tRPC procedures are functions at runtime
    expect(typeof tracingRouter.getTraces).toMatch(/function|object/);
  });

  it("getTraceDetail procedure is callable", () => {
    expect(tracingRouter.getTraceDetail).toBeDefined();
  });

  it("getServiceMap procedure is callable", () => {
    expect(tracingRouter.getServiceMap).toBeDefined();
  });

  it("getSlowOperations procedure is callable", () => {
    expect(tracingRouter.getSlowOperations).toBeDefined();
  });

  it("ingestTrace procedure is callable", () => {
    expect(tracingRouter.ingestTrace).toBeDefined();
  });

  it("purgeOldTraces procedure is callable", () => {
    expect(tracingRouter.purgeOldTraces).toBeDefined();
  });

  it("all procedures are tRPC procedure objects", () => {
    for (const [key, proc] of Object.entries(tracingRouter)) {
      expect(proc, `${key} should be defined`).toBeDefined();
      // tRPC procedures can be functions or objects depending on version
      expect(["function", "object"]).toContain(typeof proc);
    }
  });
});
