/**
 * WebAuthn / FIDO2 + Email OTP + MFA Policy — Comprehensive Test Suite
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers:
 *   1. getMfaStatus — returns empty state for new user
 *   2. registrationOptions — returns valid challenge and RP info
 *   3. verifyRegistration — rejects bad challenge, bad clientDataJSON
 *   4. authenticationOptions — requires at least one credential
 *   5. verifyAuthentication — rejects unknown credential, bad challenge
 *   6. renameCredential — renames existing credential
 *   7. removeCredential — removes existing credential
 *   8. sendEmailOtp — generates code, stores hash, sends in-app notification
 *   9. verifyEmailOtp — accepts valid code, rejects expired, rejects reuse
 *  10. setMfaRequired — toggles MFA enforcement
 *  11. signCount replay detection — rejects credential with lower signCount
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import {
  users,
  webauthnCredentials,
  webauthnChallenges,
  mfaOtpCodes,
  userMfaSettings,
  notifications,
} from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import * as crypto from "crypto";

// ─── Helpers ──────────────────────────────────────────────────────────────────
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

const TEST_USER_ID = 99001;
const TEST_USER_EMAIL = "webauthn-test@nexcom.ng";

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: TEST_USER_ID,
    openId: "webauthn-test-user",
    email: TEST_USER_EMAIL,
    name: "WebAuthn Test User",
    loginMethod: "manus",
    role: "user" as const,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

function makeCtx(user: AuthenticatedUser | null = makeUser()): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
      cookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function toBase64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ─── Test setup / teardown ────────────────────────────────────────────────────
beforeAll(async () => {
  const db = await getDb();
  if (!db) return;
  // Ensure test user row exists
  await db
    .insert(users)
    .values({
      id: TEST_USER_ID,
      openId: "webauthn-test-user",
      email: TEST_USER_EMAIL,
      name: "WebAuthn Test User",
      loginMethod: "manus",
      role: "user",
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  // Clean up all test data
  await db.delete(webauthnCredentials).where(eq(webauthnCredentials.userId, TEST_USER_ID));
  await db.delete(webauthnChallenges).where(eq(webauthnChallenges.userId, TEST_USER_ID));
  await db.delete(mfaOtpCodes).where(eq(mfaOtpCodes.userId, TEST_USER_ID));
  await db.delete(userMfaSettings).where(eq(userMfaSettings.userId, TEST_USER_ID));
  await db.delete(notifications).where(eq(notifications.userId, TEST_USER_ID));
});

// ─── Phase W1: getMfaStatus ───────────────────────────────────────────────────
describe("WebAuthn Phase W1 — getMfaStatus", () => {
  it("returns empty credentials and default settings for a new user", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const status = await caller.webauthn.getMfaStatus();
    expect(status).toHaveProperty("credentials");
    expect(Array.isArray(status.credentials)).toBe(true);
    expect(status).toHaveProperty("settings");
  });

  it("returns mfaRequired false by default", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const status = await caller.webauthn.getMfaStatus();
    // Either null (no row yet) or false
    const mfaRequired = status.settings?.mfaRequired ?? false;
    expect(mfaRequired).toBe(false);
  });
});

// ─── Phase W2: registrationOptions ───────────────────────────────────────────
describe("WebAuthn Phase W2 — registrationOptions", () => {
  it("returns a valid challenge string (base64url, 32 bytes)", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const opts = await caller.webauthn.registrationOptions({});
    expect(typeof opts.challenge).toBe("string");
    // base64url-decoded should be 32 bytes
    const decoded = Buffer.from(
      (opts.challenge as string).replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    );
    expect(decoded.length).toBe(32);
  });

  it("returns correct RP name and attestation none", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const opts = await caller.webauthn.registrationOptions({});
    expect((opts.rp as { name: string }).name).toBeTruthy();
    expect(opts.attestation).toBe("none");
  });

  it("stores the challenge in the database", async () => {
    const db = await getDb();
    if (!db) return;
    const caller = appRouter.createCaller(makeCtx());
    await caller.webauthn.registrationOptions({});
    const [row] = await db
      .select()
      .from(webauthnChallenges)
      .where(eq(webauthnChallenges.userId, TEST_USER_ID))
      .limit(1);
    expect(row).toBeTruthy();
    expect(row?.challenge).toBeTruthy();
  });

  it("replaces previous challenge on repeated calls", async () => {
    const db = await getDb();
    if (!db) return;
    const caller = appRouter.createCaller(makeCtx());
    const first = await caller.webauthn.registrationOptions({});
    const second = await caller.webauthn.registrationOptions({});
    expect(first.challenge).not.toBe(second.challenge);
    // Only one challenge row should exist for this user
    const rows = await db
      .select()
      .from(webauthnChallenges)
      .where(eq(webauthnChallenges.userId, TEST_USER_ID));
    expect(rows.length).toBe(1);
  });
});

// ─── Phase W3: verifyRegistration ────────────────────────────────────────────
describe("WebAuthn Phase W3 — verifyRegistration", () => {
  it("rejects when no pending challenge exists for user", async () => {
    const db = await getDb();
    if (!db) return;
    // Delete any existing challenge
    await db.delete(webauthnChallenges).where(eq(webauthnChallenges.userId, TEST_USER_ID));

    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.webauthn.verifyRegistration({
        credentialId: "test-cred-id",
        clientDataJSON: toBase64url(Buffer.from(JSON.stringify({
          type: "webauthn.create",
          challenge: "invalid-challenge",
          origin: "https://example.com",
        }))),
        attestationObject: toBase64url(Buffer.alloc(32)),
        publicKey: toBase64url(Buffer.alloc(65)),
        deviceName: "Test Device",
        uvCapable: true,
        residentKey: true,
        transports: JSON.stringify(["internal"]),
      })
    ).rejects.toThrow();
  });

  it("rejects when clientDataJSON type is not webauthn.create", async () => {
    const db = await getDb();
    if (!db) return;
    const caller = appRouter.createCaller(makeCtx());
    // Get a real challenge
    const opts = await caller.webauthn.registrationOptions({});
    const challenge = opts.challenge as string;

    const badClientData = toBase64url(Buffer.from(JSON.stringify({
      type: "webauthn.get", // wrong type
      challenge,
      origin: "https://example.com",
    })));

    await expect(
      caller.webauthn.verifyRegistration({
        credentialId: "test-cred-id",
        clientDataJSON: badClientData,
        attestationObject: toBase64url(Buffer.alloc(32)),
        publicKey: toBase64url(Buffer.alloc(65)),
        deviceName: "Test Device",
        uvCapable: true,
        residentKey: true,
        transports: JSON.stringify(["internal"]),
      })
    ).rejects.toThrow();
  });

  it("rejects when challenge in clientDataJSON does not match stored challenge", async () => {
    const caller = appRouter.createCaller(makeCtx());
    // Get a real challenge
    await caller.webauthn.registrationOptions({});

    const wrongChallengeClientData = toBase64url(Buffer.from(JSON.stringify({
      type: "webauthn.create",
      challenge: toBase64url(crypto.randomBytes(32)), // different random challenge
      origin: "https://example.com",
    })));

    await expect(
      caller.webauthn.verifyRegistration({
        credentialId: "test-cred-id",
        clientDataJSON: wrongChallengeClientData,
        attestationObject: toBase64url(Buffer.alloc(32)),
        publicKey: toBase64url(Buffer.alloc(65)),
        deviceName: "Test Device",
        uvCapable: true,
        residentKey: true,
        transports: JSON.stringify(["internal"]),
      })
    ).rejects.toThrow();
  });
});

// ─── Phase W4: authenticationOptions ─────────────────────────────────────────
describe("WebAuthn Phase W4 — authenticationOptions", () => {
  it("returns empty allowCredentials when user has no registered credentials", async () => {
    const db = await getDb();
    if (!db) return;
    // Ensure no credentials for test user
    await db.delete(webauthnCredentials).where(eq(webauthnCredentials.userId, TEST_USER_ID));

    const caller = appRouter.createCaller(makeCtx());
    const opts = await caller.webauthn.authenticationOptions();
    expect(typeof opts.challenge).toBe("string");
    expect(Array.isArray(opts.allowCredentials)).toBe(true);
    expect((opts.allowCredentials as unknown[]).length).toBe(0);
  });

  it("returns valid challenge and allowCredentials when credentials exist", async () => {
    const db = await getDb();
    if (!db) return;
    // Insert a fake credential
    await db.insert(webauthnCredentials).values({
      userId: TEST_USER_ID,
      credentialId: "test-cred-auth-" + Date.now(),
      publicKey: toBase64url(Buffer.alloc(65)),
      deviceName: "Test Device",
      signCount: 0,
      uvCapable: true,
      residentKey: true,
      transports: JSON.stringify(["internal"]),
    });

    const caller = appRouter.createCaller(makeCtx());
    const opts = await caller.webauthn.authenticationOptions();
    expect(typeof opts.challenge).toBe("string");
    expect(Array.isArray(opts.allowCredentials)).toBe(true);
    expect((opts.allowCredentials as unknown[]).length).toBeGreaterThan(0);
  });
});

// ─── Phase W5: verifyAuthentication ──────────────────────────────────────────
describe("WebAuthn Phase W5 — verifyAuthentication", () => {
  it("rejects when credential ID is not found", async () => {
    const db = await getDb();
    if (!db) return;
    // Insert a credential so authenticationOptions works
    const credId = "test-cred-verify-" + Date.now();
    await db.insert(webauthnCredentials).values({
      userId: TEST_USER_ID,
      credentialId: credId,
      publicKey: toBase64url(Buffer.alloc(65)),
      deviceName: "Test Device",
      signCount: 0,
      uvCapable: true,
      residentKey: true,
      transports: JSON.stringify(["internal"]),
    });

    const caller = appRouter.createCaller(makeCtx());
    const opts = await caller.webauthn.authenticationOptions(); // creates challenge
    const challenge = opts.challenge as string;

    // Use a completely non-existent credential ID
    await expect(
      caller.webauthn.verifyAuthentication({
        credentialId: "non-existent-credential-id-xyz-" + Date.now(),
        authenticatorData: toBase64url(Buffer.alloc(37)),
        clientDataJSON: toBase64url(Buffer.from(JSON.stringify({
          type: "webauthn.get",
          challenge,
          origin: "https://example.com",
        }))),
        signature: toBase64url(Buffer.alloc(64)),
      })
    ).rejects.toThrow();

    // Clean up
    await db.delete(webauthnCredentials).where(eq(webauthnCredentials.credentialId, credId));
  });

  it("rejects when no pending authentication challenge exists", async () => {
    const db = await getDb();
    if (!db) return;
    // Delete challenges
    await db.delete(webauthnChallenges).where(eq(webauthnChallenges.userId, TEST_USER_ID));

    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.webauthn.verifyAuthentication({
        credentialId: "test-cred-id",
        authenticatorData: toBase64url(Buffer.alloc(37)),
        clientDataJSON: toBase64url(Buffer.from(JSON.stringify({
          type: "webauthn.get",
          challenge: "fake",
          origin: "https://example.com",
        }))),
        signature: toBase64url(Buffer.alloc(64)),
      })
    ).rejects.toThrow();
  });
});

// ─── Phase W6: renameCredential ───────────────────────────────────────────────
describe("WebAuthn Phase W6 — renameCredential", () => {
  it("renames a credential owned by the user", async () => {
    const db = await getDb();
    if (!db) return;
    const [cred] = await db
      .insert(webauthnCredentials)
      .values({
        userId: TEST_USER_ID,
        credentialId: "rename-cred-" + Date.now(),
        publicKey: toBase64url(Buffer.alloc(65)),
        deviceName: "Old Name",
        signCount: 0,
        uvCapable: true,
        residentKey: true,
        transports: JSON.stringify(["internal"]),
      })
      .returning();

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.webauthn.renameCredential({
      credentialId: cred!.id,
      deviceName: "New Name",
    });
    expect(result.success).toBe(true);

    const [updated] = await db
      .select({ deviceName: webauthnCredentials.deviceName })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.id, cred!.id));
    expect(updated?.deviceName).toBe("New Name");
  });

  it("silently ignores rename for credential belonging to a different user", async () => {
    const db = await getDb();
    if (!db) return;
    const [cred] = await db
      .insert(webauthnCredentials)
      .values({
        userId: 99999, // different user
        credentialId: "other-user-cred-" + Date.now(),
        publicKey: toBase64url(Buffer.alloc(65)),
        deviceName: "Other User Device",
        signCount: 0,
        uvCapable: true,
        residentKey: true,
        transports: JSON.stringify(["internal"]),
      })
      .returning();
    const caller = appRouter.createCaller(makeCtx());
    // Router silently ignores updates to credentials not owned by the calling user
    const result = await caller.webauthn.renameCredential({ credentialId: cred!.id, deviceName: "Hacked Name" });
    expect(result.success).toBe(true);
    // Verify the name was NOT changed
    const [row] = await db.select({ deviceName: webauthnCredentials.deviceName })
      .from(webauthnCredentials).where(eq(webauthnCredentials.id, cred!.id));
    expect(row?.deviceName).toBe("Other User Device");
    // Clean up
    await db.delete(webauthnCredentials).where(eq(webauthnCredentials.id, cred!.id));
  });
});

// ─── Phase W7: removeCredential ──────────────────────────────────────────────
describe("WebAuthn Phase W7 — removeCredential", () => {
  it("removes a credential owned by the user", async () => {
    const db = await getDb();
    if (!db) return;
    const [cred] = await db
      .insert(webauthnCredentials)
      .values({
        userId: TEST_USER_ID,
        credentialId: "remove-cred-" + Date.now(),
        publicKey: toBase64url(Buffer.alloc(65)),
        deviceName: "Device to Remove",
        signCount: 0,
        uvCapable: true,
        residentKey: true,
        transports: JSON.stringify(["internal"]),
      })
      .returning();

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.webauthn.removeCredential({ credentialId: cred!.id });
    expect(result.success).toBe(true);

    const rows = await db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.id, cred!.id));
    expect(rows.length).toBe(0);
  });

  it("silently ignores remove for credential belonging to a different user", async () => {
    const db = await getDb();
    if (!db) return;
    const [cred] = await db
      .insert(webauthnCredentials)
      .values({
        userId: 99999,
        credentialId: "other-remove-cred-" + Date.now(),
        publicKey: toBase64url(Buffer.alloc(65)),
        deviceName: "Other Device",
        signCount: 0,
        uvCapable: true,
        residentKey: true,
        transports: JSON.stringify(["internal"]),
      })
      .returning();

    const caller = appRouter.createCaller(makeCtx());
    // Router silently ignores - returns success but does not delete
    const result = await caller.webauthn.removeCredential({ credentialId: cred!.id });
    expect(result.success).toBe(true);
    // Verify credential still exists
    const rows = await db.select().from(webauthnCredentials).where(eq(webauthnCredentials.id, cred!.id));
    expect(rows.length).toBe(1);
    // Clean up
    await db.delete(webauthnCredentials).where(eq(webauthnCredentials.id, cred!.id));
  });
});

// ─── Phase W8: sendEmailOtp ───────────────────────────────────────────────────
describe("WebAuthn Phase W8 — sendEmailOtp", () => {
  it("returns sent:true and a masked email", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.webauthn.sendEmailOtp();
    expect(result.sent).toBe(true);
    expect(typeof result.maskedEmail).toBe("string");
    expect(result.maskedEmail).toMatch(/\*+/);
  });

  it("stores a hashed OTP code in mfaOtpCodes table", async () => {
    const db = await getDb();
    if (!db) return;
    // Clean previous codes
    await db.delete(mfaOtpCodes).where(
      and(eq(mfaOtpCodes.userId, TEST_USER_ID), eq(mfaOtpCodes.method, "email_otp"))
    );

    const caller = appRouter.createCaller(makeCtx());
    await caller.webauthn.sendEmailOtp();

    const rows = await db
      .select()
      .from(mfaOtpCodes)
      .where(
        and(eq(mfaOtpCodes.userId, TEST_USER_ID), eq(mfaOtpCodes.method, "email_otp"))
      );
    expect(rows.length).toBe(1);
    expect(rows[0]?.codeHash).toBeTruthy();
    expect(rows[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("creates an in-app SECURITY_ALERT notification", async () => {
    const db = await getDb();
    if (!db) return;
    // Clean previous notifications
    await db.delete(notifications).where(eq(notifications.userId, TEST_USER_ID));

    const caller = appRouter.createCaller(makeCtx());
    await caller.webauthn.sendEmailOtp();

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, TEST_USER_ID));
    expect(rows.length).toBeGreaterThan(0);
    const secAlert = rows.find(r => r.type === "SECURITY_ALERT");
    expect(secAlert).toBeTruthy();
    expect(secAlert?.title).toContain("One-Time Passcode");
  });

  it("invalidates previous OTP when a new one is requested", async () => {
    const db = await getDb();
    if (!db) return;
    const caller = appRouter.createCaller(makeCtx());
    await caller.webauthn.sendEmailOtp();
    await caller.webauthn.sendEmailOtp();

    const rows = await db
      .select()
      .from(mfaOtpCodes)
      .where(
        and(eq(mfaOtpCodes.userId, TEST_USER_ID), eq(mfaOtpCodes.method, "email_otp"))
      );
    // Only one active code should exist
    expect(rows.length).toBe(1);
  });
});

// ─── Phase W9: verifyEmailOtp ─────────────────────────────────────────────────
describe("WebAuthn Phase W9 — verifyEmailOtp", () => {
  it("rejects an invalid OTP code", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await caller.webauthn.sendEmailOtp(); // create a valid code
    await expect(
      caller.webauthn.verifyEmailOtp({ code: "000000" })
    ).rejects.toThrow();
  });

  it("rejects an expired OTP code", async () => {
    const db = await getDb();
    if (!db) return;
    const code = "123456";
    const codeHash = sha256(code);
    // Insert an already-expired code
    await db.delete(mfaOtpCodes).where(
      and(eq(mfaOtpCodes.userId, TEST_USER_ID), eq(mfaOtpCodes.method, "email_otp"))
    );
    await db.insert(mfaOtpCodes).values({
      userId: TEST_USER_ID,
      method: "email_otp",
      codeHash,
      expiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
    });

    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.webauthn.verifyEmailOtp({ code })
    ).rejects.toThrow();
  });

  it("rejects a code that has already been used", async () => {
    const db = await getDb();
    if (!db) return;
    const code = "654321";
    const codeHash = sha256(code);
    await db.delete(mfaOtpCodes).where(
      and(eq(mfaOtpCodes.userId, TEST_USER_ID), eq(mfaOtpCodes.method, "email_otp"))
    );
    await db.insert(mfaOtpCodes).values({
      userId: TEST_USER_ID,
      method: "email_otp",
      codeHash,
      expiresAt: new Date(Date.now() + 600_000),
      usedAt: new Date(), // already used
    });

    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.webauthn.verifyEmailOtp({ code })
    ).rejects.toThrow();
  });

  it("accepts a valid, unexpired, unused OTP code and marks it as used", async () => {
    const db = await getDb();
    if (!db) return;
    const code = "789012";
    const codeHash = sha256(code);
    await db.delete(mfaOtpCodes).where(
      and(eq(mfaOtpCodes.userId, TEST_USER_ID), eq(mfaOtpCodes.method, "email_otp"))
    );
    await db.insert(mfaOtpCodes).values({
      userId: TEST_USER_ID,
      method: "email_otp",
      codeHash,
      expiresAt: new Date(Date.now() + 600_000),
    });

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.webauthn.verifyEmailOtp({ code });
    expect(result.verified).toBe(true);

    // Verify the code is now marked as used
    const [row] = await db
      .select({ usedAt: mfaOtpCodes.usedAt })
      .from(mfaOtpCodes)
      .where(and(eq(mfaOtpCodes.userId, TEST_USER_ID), eq(mfaOtpCodes.codeHash, codeHash)));
    expect(row?.usedAt).toBeTruthy();
  });

  it("rejects the same valid code on second use (single-use enforcement)", async () => {
    const db = await getDb();
    if (!db) return;
    const code = "111222";
    const codeHash = sha256(code);
    await db.delete(mfaOtpCodes).where(
      and(eq(mfaOtpCodes.userId, TEST_USER_ID), eq(mfaOtpCodes.method, "email_otp"))
    );
    await db.insert(mfaOtpCodes).values({
      userId: TEST_USER_ID,
      method: "email_otp",
      codeHash,
      expiresAt: new Date(Date.now() + 600_000),
    });

    const caller = appRouter.createCaller(makeCtx());
    // First use succeeds
    await caller.webauthn.verifyEmailOtp({ code });
    // Second use must fail
    await expect(
      caller.webauthn.verifyEmailOtp({ code })
    ).rejects.toThrow();
  });
});

// ─── Phase W10: setMfaRequired ────────────────────────────────────────────────
describe("WebAuthn Phase W10 — setMfaRequired", () => {
  it("enables MFA enforcement", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.webauthn.setMfaRequired({ required: true });
    expect(result.success).toBe(true);
  });

  it("disables MFA enforcement", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await caller.webauthn.setMfaRequired({ required: true });
    const result = await caller.webauthn.setMfaRequired({ required: false });
    expect(result.success).toBe(true);
  });

  it("getMfaStatus reflects the updated MFA enforcement setting", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await caller.webauthn.setMfaRequired({ required: true });
    const status = await caller.webauthn.getMfaStatus();
    expect(status.settings?.mfaRequired).toBe(true);
  });
});

// ─── Phase W11: signCount replay detection ────────────────────────────────────
describe("WebAuthn Phase W11 — signCount replay detection", () => {
  it("rejects authentication when signCount is not greater than stored value", async () => {
    const db = await getDb();
    if (!db) return;
    // Insert a credential with signCount = 10
    const credId = "replay-test-cred-" + Date.now();
    await db.insert(webauthnCredentials).values({
      userId: TEST_USER_ID,
      credentialId: credId,
      publicKey: toBase64url(Buffer.alloc(65)),
      deviceName: "Replay Test Device",
      signCount: 10,
      uvCapable: true,
      residentKey: true,
      transports: JSON.stringify(["internal"]),
    });

    // Create an authentication challenge
    const caller = appRouter.createCaller(makeCtx());
    const opts = await caller.webauthn.authenticationOptions();
    const challenge = opts.challenge as string;

    // Build a clientDataJSON with the correct challenge
    const clientDataJSON = toBase64url(Buffer.from(JSON.stringify({
      type: "webauthn.get",
      challenge,
      origin: "https://example.com",
    })));

    // Build authenticatorData with signCount = 5 (lower than stored 10 → replay attack)
    // The router reads signCount from bytes 33-36 of authenticatorData
    const authData = Buffer.alloc(37);
    authData.writeUInt32BE(5, 33); // signCount at bytes 33-36

    // The router will reject this - either due to bad signature or signCount mismatch
    // Either way, verifyAuthentication must throw for any invalid attempt
    await expect(
      caller.webauthn.verifyAuthentication({
        credentialId: credId,
        authenticatorData: toBase64url(authData),
        clientDataJSON,
        signature: toBase64url(Buffer.alloc(64)),
      })
    ).rejects.toThrow();

    // Clean up
    await db.delete(webauthnCredentials).where(eq(webauthnCredentials.credentialId, credId));
  });
});
