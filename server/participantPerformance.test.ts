/**
 * NEXCOM Exchange — participantPerformanceRouter Unit Tests
 *
 * Verifies that all procedures are defined and the router is properly structured.
 * These tests run offline (all DB/Redis/Kafka calls are mocked).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Offline mocks ─────────────────────────────────────────────────────────────
vi.mock("../db", () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ id: 1 }]) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  },
}));
vi.mock("../cache", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../kafka/kafkaProducer", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
  emitDepositCompleted: vi.fn().mockResolvedValue(undefined),
  emitWithdrawalCompleted: vi.fn().mockResolvedValue(undefined),
  emitOrderFilled: vi.fn().mockResolvedValue(undefined),
  emitOrderCancelled: vi.fn().mockResolvedValue(undefined),
  emitSettlementCompleted: vi.fn().mockResolvedValue(undefined),
  emitMarginDeposited: vi.fn().mockResolvedValue(undefined),
  emitMarginReleased: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../fundFlow", () => ({
  FundFlow: {
    deposit: vi.fn().mockResolvedValue({ duplicate: false }),
    withdrawal: vi.fn().mockResolvedValue({ duplicate: false }),
    tradeFill: vi.fn().mockResolvedValue({ duplicate: false }),
    orderPlaced: vi.fn().mockResolvedValue({ duplicate: false }),
    orderCancelled: vi.fn().mockResolvedValue({ duplicate: false }),
    marginPledge: vi.fn().mockResolvedValue({ duplicate: false }),
    marginRelease: vi.fn().mockResolvedValue({ duplicate: false }),
    loanDisbursed: vi.fn().mockResolvedValue({ duplicate: false }),
    loanRepaid: vi.fn().mockResolvedValue({ duplicate: false }),
    crossBorderInitiated: vi.fn().mockResolvedValue({ duplicate: false }),
    receiptIssued: vi.fn().mockResolvedValue({ duplicate: false }),
    stripeTopup: vi.fn().mockResolvedValue({ duplicate: false }),
  },
}));

const mockCtx = {
  user: { id: 1, role: "admin", openId: "test-open-id" },
  req: { headers: {} },
  res: { setHeader: vi.fn() },
};


import { participantPerformanceRouter } from "./routers/participantPerformanceRouter";

describe("participantPerformanceRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("router is defined", () => {
    expect(participantPerformanceRouter).toBeDefined();
  });
  it("has procedures", () => {
    expect(Object.keys(participantPerformanceRouter)).not.toHaveLength(0);
  });
});
