/**
 * Tests for marketAssistantRouter
 * Covers: suggestions (public), ask (protected + LLM mock)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";

// ─── Mock LLM so tests don't hit the real API ─────────────────────────────────
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            answer: "Maize is currently trading at $320/MT on the NEXCOM Exchange.",
            sources: ["Live price feed"],
            confidence: "high",
          }),
        },
      },
    ],
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeCtx(userId?: string) {
  return {
    user: userId ? { id: userId, name: "Test User", email: "test@nexcom.io", role: "user" as const } : null,
    db: null as unknown as typeof import("./db").db,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("marketAssistant.suggestions", () => {
  it("returns an array of suggestion strings", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.marketAssistant.suggestions();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    result.forEach((s: unknown) => expect(typeof s).toBe("string"));
  });
});

describe("marketAssistant.ask", () => {
  it("throws UNAUTHORIZED when not logged in", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.marketAssistant.ask({ question: "What is the price of maize?" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns an answer object when authenticated", async () => {
    const caller = appRouter.createCaller(makeCtx("user-1"));
    const result = await caller.marketAssistant.ask({
      question: "What is the price of maize?",
    });
    expect(result).toHaveProperty("answer");
    expect(typeof result.answer).toBe("string");
    expect(result.answer.length).toBeGreaterThan(0);
  });

  it("rejects empty questions", async () => {
    const caller = appRouter.createCaller(makeCtx("user-1"));
    await expect(
      caller.marketAssistant.ask({ question: "" })
    ).rejects.toThrow();
  });

  it("rejects questions exceeding 500 characters", async () => {
    const caller = appRouter.createCaller(makeCtx("user-1"));
    await expect(
      caller.marketAssistant.ask({ question: "a".repeat(501) })
    ).rejects.toThrow();
  });
});
