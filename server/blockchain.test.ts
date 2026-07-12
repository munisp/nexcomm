/**
 * Unit tests for blockchainRouter
 * Uses vi.mock to isolate fetch calls to the Blockchain service.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { blockchainRouter } from "./routers/blockchainRouter";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("./audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ status: "ok", tokens: [], transaction: null }),
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

describe("blockchainRouter", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("exports a router object", () => {
    expect(blockchainRouter).toBeDefined();
    expect(typeof blockchainRouter).toBe("object");
  });

  it("has health procedure", () => {
    expect(blockchainRouter._def.record).toHaveProperty("health");
  });

  it("has getChainStatus procedure", () => {
    expect(blockchainRouter._def.record).toHaveProperty("getChainStatus");
  });

  it("has tokenizeCommodity procedure", () => {
    expect(blockchainRouter._def.record).toHaveProperty("tokenizeCommodity");
  });

  it("has listTokens procedure", () => {
    expect(blockchainRouter._def.record).toHaveProperty("listTokens");
  });

  it("has getToken procedure", () => {
    expect(blockchainRouter._def.record).toHaveProperty("getToken");
  });

  it("has transferToken procedure", () => {
    expect(blockchainRouter._def.record).toHaveProperty("transferToken");
  });

  it("has fractionalizeToken procedure", () => {
    expect(blockchainRouter._def.record).toHaveProperty("fractionalizeToken");
  });

  it("has onChainSettle procedure", () => {
    expect(blockchainRouter._def.record).toHaveProperty("onChainSettle");
  });

  it("has getTransaction procedure", () => {
    expect(blockchainRouter._def.record).toHaveProperty("getTransaction");
  });

  it("has listFractionalAssets procedure", () => {
    expect(blockchainRouter._def.record).toHaveProperty("listFractionalAssets");
  });

  it("has at least 10 procedures", () => {
    const keys = Object.keys(blockchainRouter._def.record);
    expect(keys.length).toBeGreaterThanOrEqual(10);
  });
});
