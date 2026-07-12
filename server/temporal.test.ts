/**
 * temporal.test.ts — Unit tests for temporalRouter
 * Uses structural inspection consistent with other router tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock heavy dependencies ──────────────────────────────────────────────────
vi.mock("./temporal/temporalClient", () => ({
  triggerTemporalWorkflow: vi.fn().mockResolvedValue("temporal-wf-test-001"),
  queryTemporalWorkflow: vi.fn().mockResolvedValue({ phase: "COMPLETED", status: "SUCCESS" }),
  cancelTemporalWorkflow: vi.fn().mockResolvedValue(true),
}));
vi.mock("./audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

// ── Import router after mocks ─────────────────────────────────────────────────
import { temporalRouter } from "./routers/temporalRouter";

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("temporalRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports the temporalRouter object", () => {
    expect(temporalRouter).toBeDefined();
    expect(typeof temporalRouter).toBe("object");
  });

  it("has all expected procedures", () => {
    const procedures = Object.keys(temporalRouter);
    expect(procedures).toContain("getRegistry");
    expect(procedures).toContain("trigger");
    expect(procedures).toContain("getStatus");
    expect(procedures).toContain("cancel");
    expect(procedures).toContain("listWorkflows");
    expect(procedures.length).toBeGreaterThanOrEqual(5);
  });

  it("getRegistry procedure is defined and callable", () => {
    expect(temporalRouter.getRegistry).toBeDefined();
    expect(["function", "object"]).toContain(typeof temporalRouter.getRegistry);
  });

  it("trigger procedure is defined and callable", () => {
    expect(temporalRouter.trigger).toBeDefined();
    expect(["function", "object"]).toContain(typeof temporalRouter.trigger);
  });

  it("getStatus procedure is defined and callable", () => {
    expect(temporalRouter.getStatus).toBeDefined();
    expect(["function", "object"]).toContain(typeof temporalRouter.getStatus);
  });

  it("cancel procedure is defined and callable", () => {
    expect(temporalRouter.cancel).toBeDefined();
    expect(["function", "object"]).toContain(typeof temporalRouter.cancel);
  });

  it("listWorkflows procedure is defined and callable", () => {
    expect(temporalRouter.listWorkflows).toBeDefined();
    expect(["function", "object"]).toContain(typeof temporalRouter.listWorkflows);
  });

  it("getRegistry procedure is a query (not a mutation)", () => {
    const proc = temporalRouter.getRegistry as { _def: { type: string } };
    expect(proc._def.type).toBe("query");
  });

  it("trigger procedure is a mutation (not a query)", () => {
    const proc = temporalRouter.trigger as { _def: { type: string } };
    expect(proc._def.type).toBe("mutation");
  });

  it("getStatus procedure is a query (not a mutation)", () => {
    const proc = temporalRouter.getStatus as { _def: { type: string } };
    expect(proc._def.type).toBe("query");
  });

  it("cancel procedure is a mutation (not a query)", () => {
    const proc = temporalRouter.cancel as { _def: { type: string } };
    expect(proc._def.type).toBe("mutation");
  });

  it("listWorkflows procedure is a query (not a mutation)", () => {
    const proc = temporalRouter.listWorkflows as { _def: { type: string } };
    expect(proc._def.type).toBe("query");
  });

  it("temporalRouter is a valid tRPC router with _def", () => {
    expect(temporalRouter).toHaveProperty("_def");
  });

  it("all procedures are valid tRPC procedure objects", () => {
    for (const [key, proc] of Object.entries(temporalRouter)) {
      expect(proc, `${key} should be defined`).toBeDefined();
      expect(["function", "object"]).toContain(typeof proc);
    }
  });
});
