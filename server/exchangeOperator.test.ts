/**
 * NEXCOM Exchange — exchangeOperatorRouter Unit Tests
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
        returning: vi.fn().mockResolvedValue([{
          id: 1,
          operatorCode: "TEST01",
          legalName: "Test Operator Ltd",
          status: "pending",
          createdAt: new Date(),
        }]),
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1, status: "active" }]),
        }),
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

vi.mock("./keycloak/keycloakClient", () => ({
  syncUserToKeycloak: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./temporal/temporalClient", () => ({
  triggerTemporalWorkflow: vi.fn().mockResolvedValue({ workflowId: "wf-test-123" }),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

// ── Import router under test ──────────────────────────────────────────────────
import { exchangeOperatorRouter } from "./routers/exchangeOperatorRouter";

describe("exchangeOperatorRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("router is defined", () => {
    expect(exchangeOperatorRouter).toBeDefined();
  });

  it("has all expected procedures", () => {
    const keys = Object.keys(exchangeOperatorRouter);
    const expected = [
      "register",
      "setInstruments",
      "setFees",
      "setSettlementRules",
      "activate",
      "suspend",
      "list",
      "getDetail",
      "listAvailableInstruments",
    ];
    for (const key of expected) {
      expect(keys, `Missing procedure: ${key}`).toContain(key);
    }
  });

  it("register procedure is defined", () => {
    expect(exchangeOperatorRouter.register).toBeDefined();
    expect(["function", "object"]).toContain(typeof exchangeOperatorRouter.register);
  });

  it("setInstruments procedure is defined", () => {
    expect(exchangeOperatorRouter.setInstruments).toBeDefined();
  });

  it("setFees procedure is defined", () => {
    expect(exchangeOperatorRouter.setFees).toBeDefined();
  });

  it("setSettlementRules procedure is defined", () => {
    expect(exchangeOperatorRouter.setSettlementRules).toBeDefined();
  });

  it("activate procedure is defined", () => {
    expect(exchangeOperatorRouter.activate).toBeDefined();
  });

  it("suspend procedure is defined", () => {
    expect(exchangeOperatorRouter.suspend).toBeDefined();
  });

  it("list procedure is defined", () => {
    expect(exchangeOperatorRouter.list).toBeDefined();
  });

  it("getDetail procedure is defined", () => {
    expect(exchangeOperatorRouter.getDetail).toBeDefined();
  });

  it("listAvailableInstruments procedure is defined", () => {
    expect(exchangeOperatorRouter.listAvailableInstruments).toBeDefined();
  });

  it("all procedures are defined", () => {
    for (const [key, proc] of Object.entries(exchangeOperatorRouter)) {
      expect(proc, `${key} should be defined`).toBeDefined();
      expect(["function", "object"]).toContain(typeof proc);
    }
  });

  it("has at least 9 business procedures", () => {
    // Router also exposes _def and createCaller internally
    const businessKeys = Object.keys(exchangeOperatorRouter).filter(
      (k) => !["_def", "createCaller"].includes(k)
    );
    expect(businessKeys.length).toBeGreaterThanOrEqual(9);
  });
});
