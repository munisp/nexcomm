/**
 * Validates that all 5 microservice URL environment variables are
 * defined in server/_core/env.ts (Issue #18 fix verification).
 */
import { describe, it, expect } from "vitest";
import { ENV } from "./_core/env";

describe("Microservice URL env vars (Issue #18)", () => {
  it("ENV.coreBankingUrl is defined as a string", () => {
    expect(typeof ENV.coreBankingUrl).toBe("string");
  });

  it("ENV.channelGatewayUrl is defined as a string", () => {
    expect(typeof ENV.channelGatewayUrl).toBe("string");
  });

  it("ENV.botLogicUrl is defined as a string", () => {
    expect(typeof ENV.botLogicUrl).toBe("string");
  });

  it("ENV.ussdEngineUrl is defined as a string", () => {
    expect(typeof ENV.ussdEngineUrl).toBe("string");
  });

  it("ENV.indicesServiceUrl is defined as a string", () => {
    expect(typeof ENV.indicesServiceUrl).toBe("string");
  });

  it("All 5 microservice URL keys exist in ENV object", () => {
    const keys = Object.keys(ENV);
    expect(keys).toContain("coreBankingUrl");
    expect(keys).toContain("channelGatewayUrl");
    expect(keys).toContain("botLogicUrl");
    expect(keys).toContain("ussdEngineUrl");
    expect(keys).toContain("indicesServiceUrl");
  });
});
