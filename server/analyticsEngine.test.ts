/**
 * Unit tests for analyticsEngineRouter
 * Uses vi.mock to isolate fetch calls to the Analytics Engine service.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyticsEngineRouter } from "./routers/analyticsEngineRouter";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("./audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// Mock global fetch to prevent real HTTP calls
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ status: "ok", data: [] }),
  text: async () => "ok",
});
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

const publicCtx = {
  user: null,
  req: {} as never,
  res: {} as never,
};

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

describe("analyticsEngineRouter", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("exports a router object", () => {
    expect(analyticsEngineRouter).toBeDefined();
    expect(typeof analyticsEngineRouter).toBe("object");
  });

  it("has health procedure", () => {
    expect(analyticsEngineRouter._def.record).toHaveProperty("health");
  });

  it("has getMarketMicrostructure procedure", () => {
    expect(analyticsEngineRouter._def.record).toHaveProperty("getMarketMicrostructure");
  });

  it("has getVolumeAnalysis procedure", () => {
    expect(analyticsEngineRouter._def.record).toHaveProperty("getVolumeAnalysis");
  });

  it("has getPriceDiscovery procedure", () => {
    expect(analyticsEngineRouter._def.record).toHaveProperty("getPriceDiscovery");
  });

  it("has getExchangeStats procedure", () => {
    expect(analyticsEngineRouter._def.record).toHaveProperty("getExchangeStats");
  });

  it("has getTopMovers procedure", () => {
    expect(analyticsEngineRouter._def.record).toHaveProperty("getTopMovers");
  });

  it("has getMostActive procedure", () => {
    expect(analyticsEngineRouter._def.record).toHaveProperty("getMostActive");
  });

  it("has getOhlcv procedure", () => {
    expect(analyticsEngineRouter._def.record).toHaveProperty("getOhlcv");
  });

  it("has getTradeHistory procedure", () => {
    expect(analyticsEngineRouter._def.record).toHaveProperty("getTradeHistory");
  });

  it("has getPortfolioAnalytics procedure", () => {
    expect(analyticsEngineRouter._def.record).toHaveProperty("getPortfolioAnalytics");
  });

  it("has at least 10 procedures", () => {
    const keys = Object.keys(analyticsEngineRouter._def.record);
    expect(keys.length).toBeGreaterThanOrEqual(10);
  });
});
