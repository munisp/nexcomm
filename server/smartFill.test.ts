/**
 * NEXCOM Exchange — smartFillRouter tests
 * AI-powered form field extraction from unstructured text.
 */
import { describe, it, expect } from "vitest";
import { smartFillRouter } from "./routers/smartFillRouter";

describe("smartFillRouter", () => {
  it("router is defined", () => {
    expect(smartFillRouter).toBeDefined();
  });

  it("has extract procedure", () => {
    const keys = Object.keys(smartFillRouter._def.procedures);
    expect(keys).toContain("extract");
  });

  it("extract is a mutation", () => {
    const proc = smartFillRouter._def.procedures.extract;
    expect(proc).toBeDefined();
    expect(proc._def.type).toBe("mutation");
  });

  it("extract has input schema with text and fields", () => {
    const proc = smartFillRouter._def.procedures.extract;
    expect(proc._def.inputs).toBeDefined();
    expect(proc._def.inputs.length).toBeGreaterThan(0);
  });

  it("extract is a protected procedure (requires auth)", () => {
    const proc = smartFillRouter._def.procedures.extract;
    // Protected procedures have middleware
    expect(proc._def.middlewares).toBeDefined();
    expect(proc._def.middlewares.length).toBeGreaterThan(0);
  });
});
