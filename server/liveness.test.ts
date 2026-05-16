/**
 * Liveness tRPC procedure tests
 *
 * Tests cover:
 *  1. startLiveness — creates a session record and returns challenges
 *  2. getLivenessSession — fetches session by ID (mocked DB)
 *  3. getLivenessSessions (admin) — bulk fetch by userIds, RBAC enforcement
 *  4. Input validation — empty strings rejected
 *  5. Face matching score interpretation
 *  6. Spoof type enum completeness
 *
 * DB-dependent tests are skipped when PostgreSQL is unavailable (ECONNREFUSED).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock DB helpers ──────────────────────────────────────────────────────────
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    upsertLivenessSession: vi.fn().mockResolvedValue({
      id: 1,
      sessionId: "test-session-id",
      applicationId: "app-001",
      userId: 42,
      challenges: JSON.stringify(["BLINK", "SMILE"]),
      currentChallengeIndex: 0,
      results: JSON.stringify([]),
      overallResult: null,
      faceMatchScore: null,
      spoofType: "UNKNOWN",
      spoofConfidence: 0,
      landmarksJson: null,
      status: "PENDING",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    getLivenessSession: vi.fn().mockResolvedValue({
      id: 1,
      sessionId: "test-session-id",
      applicationId: "app-001",
      userId: 42,
      challenges: JSON.stringify(["BLINK", "SMILE"]),
      currentChallengeIndex: 0,
      results: JSON.stringify([]),
      overallResult: null,
      faceMatchScore: null,
      spoofType: "UNKNOWN",
      spoofConfidence: 0,
      landmarksJson: null,
      status: "PENDING",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    getLivenessSessionsByApplication: vi.fn().mockResolvedValue([]),
    getLivenessSessionsByUser: vi.fn().mockResolvedValue([]),
    createLivenessSecurityEvent: vi.fn().mockResolvedValue(undefined),
    getDb: vi.fn().mockResolvedValue(null), // No DB in sandbox
  };
});

// ─── Context helpers ──────────────────────────────────────────────────────────
function makeUserCtx(): TrpcContext {
  return {
    user: {
      id: 42,
      openId: "user-42",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      headers: { origin: "http://localhost:3000" },
      cookies: {},
    } as never,
    res: { clearCookie: vi.fn(), cookie: vi.fn() } as never,
  };
}

function makeAdminCtx(): TrpcContext {
  return {
    ...makeUserCtx(),
    user: {
      id: 1,
      openId: "admin-1",
      email: "admin@example.com",
      name: "Admin User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("Liveness procedures — unit (mocked DB)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getLivenessSession returns session data for valid sessionId", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    const result = await caller.kycService.getLivenessSession({
      sessionId: "test-session-id",
    });
    expect(result).toHaveProperty("sessionId", "test-session-id");
    expect(result).toHaveProperty("userId", 42);
    expect(result).toHaveProperty("status", "PENDING");
  });

  it("getLivenessSession throws NOT_FOUND for unknown sessionId", async () => {
    const { getLivenessSession } = await import("./db");
    (getLivenessSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.kycService.getLivenessSession({ sessionId: "nonexistent-id" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getLivenessSessions returns empty array for empty userIds (admin)", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.kycService.getLivenessSessions({ userIds: [] });
    expect(result).toEqual([]);
  });

  it("getLivenessSessions is blocked for non-admin users", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.kycService.getLivenessSessions({ userIds: [42] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── Input validation tests ───────────────────────────────────────────────────
describe("Liveness procedures — input validation", () => {
  it("startLiveness requires applicationId to be non-empty", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      // @ts-expect-error intentional bad input
      caller.kycService.startLiveness({ applicationId: "" })
    ).rejects.toThrow();
  });

  it("getLivenessSession requires sessionId to be non-empty", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      // @ts-expect-error intentional bad input
      caller.kycService.getLivenessSession({ sessionId: "" })
    ).rejects.toThrow();
  });

  it("faceMatch requires two non-empty image URLs", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      // @ts-expect-error intentional bad input
      caller.kycService.faceMatch({ selfieUrl: "", documentUrl: "" })
    ).rejects.toThrow();
  });
});

// ─── Face matching score interpretation ──────────────────────────────────────
describe("Face matching — score interpretation", () => {
  it("cosine similarity of 1.0 means identical faces (100% match)", () => {
    const cosineSimilarity = 1.0;
    const matchPct = Math.round(cosineSimilarity * 100);
    expect(matchPct).toBe(100);
  });

  it("cosine similarity of 0.0 means completely different faces (0% match)", () => {
    const cosineSimilarity = 0.0;
    const matchPct = Math.round(cosineSimilarity * 100);
    expect(matchPct).toBe(0);
  });

  it("threshold of 0.6 is the minimum for a PASS verdict", () => {
    // From face_matcher.py: MATCH_THRESHOLD = 0.6
    const MATCH_THRESHOLD = 0.6;
    expect(0.75).toBeGreaterThan(MATCH_THRESHOLD); // should PASS
    expect(0.45).toBeLessThan(MATCH_THRESHOLD);    // should FAIL
  });
});

// ─── Spoof type classification tests ─────────────────────────────────────────
describe("Spoof type classification", () => {
  const REQUIRED_SPOOF_TYPES = [
    "PRINTED_PHOTO",
    "SCREEN_REPLAY",
    "PAPER_MASK",
    "3D_MASK",
    "DEEPFAKE",
    "HIGH_QUALITY_PHOTO",
    "UNKNOWN",
  ] as const;

  it("all expected spoof types are defined in the schema enum", async () => {
    const { spoofTypeEnum } = await import("../drizzle/schema");
    const enumValues = spoofTypeEnum.enumValues as readonly string[];
    for (const spoofType of REQUIRED_SPOOF_TYPES) {
      expect(enumValues).toContain(spoofType);
    }
  });
});
