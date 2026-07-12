/**
 * Unit tests for aiMlRouter
 * Uses vi.mock to isolate fetch calls to the AI/ML service.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { aiMlRouter } from "./routers/aiMlRouter";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("./audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

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

describe("aiMlRouter", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("exports a router object", () => {
    expect(aiMlRouter).toBeDefined();
    expect(typeof aiMlRouter).toBe("object");
  });

  it("has health procedure", () => {
    expect(aiMlRouter._def.record).toHaveProperty("health");
  });

  it("has getRiskScore procedure", () => {
    expect(aiMlRouter._def.record).toHaveProperty("getRiskScore");
  });

  it("has getForecast procedure", () => {
    expect(aiMlRouter._def.record).toHaveProperty("getForecast");
  });

  it("has getForecastModels procedure", () => {
    expect(aiMlRouter._def.record).toHaveProperty("getForecastModels");
  });

  it("has getSentiment procedure", () => {
    expect(aiMlRouter._def.record).toHaveProperty("getSentiment");
  });

  it("has getSentimentSummary procedure", () => {
    expect(aiMlRouter._def.record).toHaveProperty("getSentimentSummary");
  });

  it("has getNewsSentiment procedure", () => {
    expect(aiMlRouter._def.record).toHaveProperty("getNewsSentiment");
  });

  it("has getRecentAnomalies procedure", () => {
    expect(aiMlRouter._def.record).toHaveProperty("getRecentAnomalies");
  });

  it("has getAnomaliesForSymbol procedure", () => {
    expect(aiMlRouter._def.record).toHaveProperty("getAnomaliesForSymbol");
  });

  it("has getAnomalyStats procedure", () => {
    expect(aiMlRouter._def.record).toHaveProperty("getAnomalyStats");
  });

  it("has at least 10 procedures", () => {
    const keys = Object.keys(aiMlRouter._def.record);
    expect(keys.length).toBeGreaterThanOrEqual(10);
  });
});
