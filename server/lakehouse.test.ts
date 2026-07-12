/**
 * Unit tests for lakehouseRouter
 * Uses vi.mock to isolate fetch calls to the Lakehouse/Ingestion Engine service.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { lakehouseRouter } from "./routers/lakehouseRouter";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("./audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ status: "ok", catalog: [], feeds: [], metrics: {} }),
  text: async () => "ok",
});
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminCtx = {
  user: { id: 1, role: "admin" as const, email: "admin@nexcom.io", name: "Admin" },
  req: {} as never,
  res: {} as never,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("lakehouseRouter", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("exports a router object", () => {
    expect(lakehouseRouter).toBeDefined();
    expect(typeof lakehouseRouter).toBe("object");
  });

  it("has health procedure", () => {
    expect(lakehouseRouter._def.record).toHaveProperty("health");
  });

  it("has getStatus procedure", () => {
    expect(lakehouseRouter._def.record).toHaveProperty("getStatus");
  });

  it("has getCatalog procedure", () => {
    expect(lakehouseRouter._def.record).toHaveProperty("getCatalog");
  });

  it("has query procedure", () => {
    expect(lakehouseRouter._def.record).toHaveProperty("query");
  });

  it("has getLineage procedure", () => {
    expect(lakehouseRouter._def.record).toHaveProperty("getLineage");
  });

  it("has getFeeds procedure", () => {
    expect(lakehouseRouter._def.record).toHaveProperty("getFeeds");
  });

  it("has getFeedStatus procedure", () => {
    expect(lakehouseRouter._def.record).toHaveProperty("getFeedStatus");
  });

  it("has startFeed procedure", () => {
    expect(lakehouseRouter._def.record).toHaveProperty("startFeed");
  });

  it("has stopFeed procedure", () => {
    expect(lakehouseRouter._def.record).toHaveProperty("stopFeed");
  });

  it("has getFeedMetrics procedure", () => {
    expect(lakehouseRouter._def.record).toHaveProperty("getFeedMetrics");
  });

  it("has at least 10 procedures", () => {
    const keys = Object.keys(lakehouseRouter._def.record);
    expect(keys.length).toBeGreaterThanOrEqual(10);
  });
});
