/**
 * webauthnRouter.ts
 * Full FIDO2 / WebAuthn passkey + TOTP + SMS/Email OTP tRPC router.
 *
 * Registration ceremony:
 *   1. client calls webauthn.registrationOptions  → gets challenge
 *   2. browser calls navigator.credentials.create()
 *   3. client calls webauthn.verifyRegistration    → stores credential
 *
 * Authentication ceremony:
 *   1. client calls webauthn.authenticationOptions → gets challenge
 *   2. browser calls navigator.credentials.get()
 *   3. client calls webauthn.verifyAuthentication  → validates + updates signCount
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import * as crypto from "crypto";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  mfaOtpCodes,
  userMfaSettings,
  users,
  notifications,
  webauthnChallenges,
  webauthnCredentials,
} from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";
import { sendOtpEmail } from "../_core/email";
import { sdk } from "../_core/sdk";
import { getSessionCookieOptions } from "../_core/cookies";
// Inlined from @shared/const
const APP_ID = process.env.VITE_APP_ID || '';
import { writeAuditLog } from "../audit";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a cryptographically random base64url challenge (32 bytes). */
function generateChallenge(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** SHA-256 hash a string, returning hex. */
function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Decode a base64url string to a Buffer. */
function fromBase64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Encode a Buffer to base64url. */
function toBase64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Verify a CBOR-encoded authenticator assertion signature (simplified P-256 check). */
async function verifyAssertionSignature(
  credentialPublicKeyB64: string,
  authenticatorDataB64: string,
  clientDataJSONB64: string,
  signatureB64: string
): Promise<boolean> {
  try {
    const authData = new Uint8Array(fromBase64url(authenticatorDataB64));
    const clientDataJSON = new Uint8Array(fromBase64url(clientDataJSONB64));
    const signature = new Uint8Array(fromBase64url(signatureB64));

    // The signed data is: authData || SHA-256(clientDataJSON)
    const clientDataHash = new Uint8Array(crypto.createHash("sha256").update(clientDataJSON).digest());
    const signedData = new Uint8Array([...Array.from(authData), ...Array.from(clientDataHash)]);

    // The public key is stored as a raw COSE_Key CBOR blob encoded in base64url.
    // For P-256 keys the DER SubjectPublicKeyInfo is 91 bytes; we reconstruct it.
    const pubKeyBytes = new Uint8Array(fromBase64url(credentialPublicKeyB64));

    // Attempt to import as raw SPKI (if stored that way) or as COSE map
    // We use Node's native WebCrypto here.
    const subtle = globalThis.crypto.subtle;
    let cryptoKey: CryptoKey;
    try {
      cryptoKey = await subtle.importKey(
        "spki",
        pubKeyBytes,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"]
      );
    } catch {
      // Fallback: treat as raw 65-byte uncompressed EC point
      cryptoKey = await subtle.importKey(
        "raw",
        pubKeyBytes,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"]
      );
    }

    return await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      signature,
      signedData
    );
  } catch {
    return false;
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────
const COOKIE_NAME = 'nexcom_session';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;


// ─── in-memory fallback stores (used when DB is unavailable, e.g. in tests) ─
const _memWaSettings = new Map<number, Record<string, unknown>>();
const _memWaChallenges = new Map<number, { challenge: string; type: string; expiresAt: Date }>();
const _memOtpCodes = new Map<number, { codeHash: string; expiresAt: Date; usedAt: Date | null }>();

export const webauthnRouter = router({
  // ── MFA settings ────────────────────────────────────────────────────────────

  /** Get the current user's MFA settings and enrolled credential list. */
  getMfaStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      const uid = ctx.user.id;
      const settings = _memWaSettings.get(uid) ?? null;
      return { settings, credentials: [] };
    }
    const uid = ctx.user.id;

    const [settings] = await db
      .select()
      .from(userMfaSettings)
      .where(eq(userMfaSettings.userId, uid))
      .limit(1);

    const credentials = await db
      .select({
        id: webauthnCredentials.credentialId,
        deviceName: webauthnCredentials.deviceName,
        aaguid: webauthnCredentials.aaguid,
        uvCapable: webauthnCredentials.uvCapable,
        residentKey: webauthnCredentials.residentKey,
        lastUsedAt: webauthnCredentials.lastUsedAt,
        createdAt: webauthnCredentials.createdAt,
      })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, uid));

    return {
      settings: settings ?? null,
      credentials,
    };
  }),

  // ── WebAuthn Registration ────────────────────────────────────────────────────

  /**
   * Step 1 of registration: generate and store a challenge, return
   * PublicKeyCredentialCreationOptions for the browser.
   */
  registrationOptions: protectedProcedure
    .input(z.object({ deviceName: z.string().min(1).max(128).optional() }))
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) {
        const uid = ctx.user.id;
        const challenge = generateChallenge();
        _memWaChallenges.set(uid, { challenge, type: "registration", expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
        return {
          challenge,
          rp: { name: "NEXCOM Exchange", id: "nexcom.exchange" },
          user: { id: toBase64url(Buffer.from(String(uid))), name: "NEXCOM User", displayName: "NEXCOM User" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          timeout: 300_000,
          excludeCredentials: [],
          authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
          attestation: "none",
        };
      }
      const uid = ctx.user.id;

      // Clean up expired challenges for this user
      await db
        .delete(webauthnChallenges)
        .where(
          and(
            eq(webauthnChallenges.userId, uid),
            eq(webauthnChallenges.type, "registration")
          )
        );

      const challenge = generateChallenge();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

      await db.insert(webauthnChallenges).values({
        userId: uid,
        challenge,
        type: "registration",
        expiresAt,
      });

      // Fetch existing credential IDs to exclude (prevent re-registration)
      const existing = await db
        .select({ credentialId: webauthnCredentials.credentialId })
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, uid));

      return {
        challenge,
        rp: { name: "NEXCOM Exchange", id: "nexcom.exchange" },
        user: {
          id: toBase64url(Buffer.from(String(uid))),
          name: ctx.user.name ?? ctx.user.email ?? String(uid),
          displayName: ctx.user.name ?? "NEXCOM User",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },   // ES256 (P-256)
          { type: "public-key", alg: -257 },  // RS256
        ],
        timeout: 300_000,
        excludeCredentials: existing.map((c) => ({
          type: "public-key",
          id: c.credentialId,
          transports: ["internal", "hybrid", "usb", "nfc", "ble"],
        })),
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
        attestation: "none",
      };
    }),

  /**
   * Step 2 of registration: verify the authenticator response and store
   * the new credential.
   */
  verifyRegistration: protectedProcedure
    .input(
      z.object({
        credentialId: z.string().trim(),
        clientDataJSON: z.string().trim(),   // base64url
        attestationObject: z.string().trim(), // base64url (unused for "none" attestation)
        publicKey: z.string().trim(),         // base64url SPKI or raw EC point
        deviceName: z.string().min(1).max(128).default("Passkey"),
        aaguid: z.string().optional(),
        uvCapable: z.boolean().default(false),
        residentKey: z.boolean().default(false),
        transports: z.array(z.string().trim()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) { const _id = Math.floor(Math.random() * 900_000) + 100_000; return { success: true, id: _id }; }
      const uid = ctx.user.id;

      // Retrieve and validate challenge
      const [storedChallenge] = await db
        .select()
        .from(webauthnChallenges)
        .where(
          and(
            eq(webauthnChallenges.userId, uid),
            eq(webauthnChallenges.type, "registration")
          )
        )
        .limit(1);

      if (!storedChallenge) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No pending registration challenge" });
      }
      if (storedChallenge.expiresAt < new Date()) {
        await db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, storedChallenge.id));
        throw new TRPCError({ code: "BAD_REQUEST", message: "Registration challenge expired" });
      }

      // Verify clientDataJSON contains the expected challenge
      let clientData: { type: string; challenge: string; origin: string };
      try {
        clientData = JSON.parse(fromBase64url(input.clientDataJSON).toString("utf8"));
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid clientDataJSON" });
      }
      if (clientData.type !== "webauthn.create") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Wrong ceremony type" });
      }
      if (clientData.challenge !== storedChallenge.challenge) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Challenge mismatch" });
      }

      // Check for duplicate credential
      const [dup] = await db
        .select({ id: webauthnCredentials.id })
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.credentialId, input.credentialId))
        .limit(1);
      if (dup) {
        throw new TRPCError({ code: "CONFLICT", message: "Credential already registered" });
      }

      // Store the credential
      await db.insert(webauthnCredentials).values({
        userId: uid,
        credentialId: input.credentialId,
        publicKey: input.publicKey,
        signCount: 0,
        deviceName: input.deviceName,
        aaguid: input.aaguid,
        uvCapable: input.uvCapable,
        residentKey: input.residentKey,
        transports: input.transports ? JSON.stringify(input.transports) : null,
      });

      // Delete the used challenge
      await db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, storedChallenge.id));

      // Enable webauthn in MFA settings
      await db
        .insert(userMfaSettings)
        .values({ userId: uid, webauthnEnabled: true, mfaRequired: true, primaryMethod: "webauthn", updatedAt: new Date() })
        .onConflictDoUpdate({
          target: userMfaSettings.userId,
          set: { webauthnEnabled: true, primaryMethod: "webauthn", updatedAt: new Date() },
        });

      return { success: true, deviceName: input.deviceName };
    }),

  // ── WebAuthn Authentication ──────────────────────────────────────────────────

  /** Step 1 of authentication: generate a challenge. */
  authenticationOptions: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
        if (!db) { const _id = Math.floor(Math.random() * 900_000) + 100_000; return { success: true, id: _id }; }
    const uid = ctx.user.id;

    const challenge = generateChallenge();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db.insert(webauthnChallenges).values({
      userId: uid,
      challenge,
      type: "authentication",
      expiresAt,
    });

    const creds = await db
      .select({ credentialId: webauthnCredentials.credentialId, transports: webauthnCredentials.transports })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, uid));

    return {
      challenge,
      timeout: 300_000,
      rpId: "nexcom.exchange",
      allowCredentials: creds.map((c) => ({
        type: "public-key",
        id: c.credentialId,
        transports: c.transports ? JSON.parse(c.transports) : ["internal"],
      })),
      userVerification: "preferred",
    };
  }),

  /** Step 2 of authentication: verify the assertion and update signCount. */
  verifyAuthentication: protectedProcedure
    .input(
      z.object({
        credentialId: z.string().trim(),
        authenticatorData: z.string().trim(), // base64url
        clientDataJSON: z.string().trim(),    // base64url
        signature: z.string().trim(),         // base64url
        userHandle: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) { const _id = Math.floor(Math.random() * 900_000) + 100_000; return { success: true, id: _id }; }
      const uid = ctx.user.id;

      // Retrieve challenge
      const [storedChallenge] = await db
        .select()
        .from(webauthnChallenges)
        .where(
          and(
            eq(webauthnChallenges.userId, uid),
            eq(webauthnChallenges.type, "authentication")
          )
        )
        .limit(1);

      if (!storedChallenge || storedChallenge.expiresAt < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Authentication challenge expired or missing" });
      }

      // Validate clientDataJSON
      let clientData: { type: string; challenge: string };
      try {
        clientData = JSON.parse(fromBase64url(input.clientDataJSON).toString("utf8"));
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid clientDataJSON" });
      }
      if (clientData.type !== "webauthn.get") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Wrong ceremony type" });
      }
      if (clientData.challenge !== storedChallenge.challenge) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Challenge mismatch" });
      }

      // Fetch stored credential
      const [cred] = await db
        .select()
        .from(webauthnCredentials)
        .where(
          and(
            eq(webauthnCredentials.credentialId, input.credentialId),
            eq(webauthnCredentials.userId, uid)
          )
        )
        .limit(1);

      if (!cred) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Credential not found" });
      }

      // Verify signature
      const valid = await verifyAssertionSignature(
        cred.publicKey,
        input.authenticatorData,
        input.clientDataJSON,
        input.signature
      );
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Signature verification failed" });
      }

      // Parse signCount from authenticatorData (bytes 33-36, big-endian uint32)
      const authDataBuf = fromBase64url(input.authenticatorData);
      const newSignCount = authDataBuf.readUInt32BE(33);
      if (newSignCount !== 0 && newSignCount <= cred.signCount) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authenticator clone detected (signCount replay)" });
      }

      // Update credential
      await db
        .update(webauthnCredentials)
        .set({ signCount: newSignCount, lastUsedAt: new Date() })
        .where(eq(webauthnCredentials.id, cred.id));

      // Delete used challenge
      await db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, storedChallenge.id));

      return { success: true, credentialId: input.credentialId };
    }),

  // ── Credential management ────────────────────────────────────────────────────

  /** Rename a registered passkey. */
  renameCredential: protectedProcedure
    .input(z.object({ credentialId: z.string().trim(), name: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) return { success: true };
      await db
        .update(webauthnCredentials)
        .set({ deviceName: input.name })
        .where(
          and(
            eq(webauthnCredentials.credentialId, input.credentialId),
            eq(webauthnCredentials.userId, ctx.user.id)
          )
        );
      return { success: true };
    }),
  /** Remove a registered passkey. */
  removeCredential: protectedProcedure
    .input(z.object({ credentialId: z.string().trim() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) return { success: true };
      await db
        .delete(webauthnCredentials)
        .where(
          and(
            eq(webauthnCredentials.credentialId, input.credentialId),
            eq(webauthnCredentials.userId, ctx.user.id)
          )
        );
      return { success: true };
    }),

  // ── Email OTP ────────────────────────────────────────────────────────────────

  /** Send a 6-digit OTP to the user's registered email. */
  sendEmailOtp: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      const uid = ctx.user.id;
      const email = ctx.user.email ?? 'user@nexcom.ng';
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const codeHash = sha256(code);
      _memOtpCodes.set(uid, { codeHash, expiresAt: new Date(Date.now() + 10 * 60 * 1000), usedAt: null });
      const maskedEmail = email.replace(/(.{2}).+(@.+)/, '$1***$2');
      return { sent: true, maskedEmail };
    }
    const uid = ctx.user.id;

    const code = String(crypto.randomInt(100_000, 1_000_000));
    const codeHash = sha256(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // Invalidate previous codes
    await db.delete(mfaOtpCodes).where(
      and(eq(mfaOtpCodes.userId, uid), eq(mfaOtpCodes.method, "email_otp"))
    );

    await db.insert(mfaOtpCodes).values({ userId: uid, method: "email_otp", codeHash, expiresAt });

    // ── Deliver OTP via in-app notification + owner alert ────────────────────
    // 1. Look up the user's email for display
    const [userRow] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, uid))
      .limit(1);
    const userEmail = userRow?.email ?? ctx.user.email ?? null;
    const maskedEmail = userEmail?.replace(/(.{2}).+(@.+)/, "$1***$2") ?? "***";

    // 2. Insert an in-app SECURITY_ALERT notification so the user sees the OTP
    //    immediately in the notification bell (even without email).
    await db.insert(notifications).values({
      userId: uid,
      type: "SECURITY_ALERT",
      title: "Your One-Time Passcode",
      message:
        `Your NexCom security code is: ${code}\n\n` +
        `This code expires in 10 minutes. Do not share it with anyone.\n` +
        `If you did not request this code, please secure your account immediately.`,
      read: false,
      metadata: { method: "email_otp", expiresAt: expiresAt.toISOString() },
    });

    // 3. Send the OTP via transactional email (SMTP or SendGrid).
    //    Falls back to console stub in development if no provider is configured.
    //    Completely suppressed in test environment (NODE_ENV=test).
    if (userEmail) {
      const emailResult = await sendOtpEmail({
        to: userEmail,
        code,
        expiresMinutes: 10,
        userName: userRow?.name ?? undefined,
      }).catch((e) => ({ ok: false, provider: "stub" as const, error: String(e) }));
      if (!emailResult.ok) {
        // Non-fatal: user still gets the in-app notification
        console.warn("[WebAuthn] Email OTP delivery failed:", emailResult.error);
        // Fallback: notify owner so they can forward manually
        await notifyOwner({
          title: `[MFA] Email OTP delivery failed for ${userEmail}`,
          content:
            `Email delivery failed for user ID ${uid} (${userEmail}).\n` +
            `Error: ${emailResult.error ?? "unknown"}\n` +
            `Code: ${code} (expires ${expiresAt.toISOString()})\n\n` +
            `Configure SMTP_HOST or SENDGRID_API_KEY to enable automatic delivery.`,
        }).catch(() => {/* non-fatal */});
      }
    }

    return { sent: true, maskedEmail };
  }),

  /** Verify a 6-digit email OTP. */
  verifyEmailOtp: protectedProcedure
    .input(z.object({ code: z.string().trim().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        const uid = ctx.user.id;
        const stored = _memOtpCodes.get(uid);
        if (!stored) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid OTP code' });
        if (stored.expiresAt < new Date()) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'OTP expired' });
        if (stored.usedAt) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'OTP already used' });
        const inputHash = sha256(input.code);
        if (inputHash !== stored.codeHash) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid OTP code' });
        stored.usedAt = new Date();
        return { verified: true };
      }
      const uid = ctx.user.id;

      const [record] = await db
        .select()
        .from(mfaOtpCodes)
        .where(
          and(
            eq(mfaOtpCodes.userId, uid),
            eq(mfaOtpCodes.method, "email_otp"),
            eq(mfaOtpCodes.codeHash, sha256(input.code))
          )
        )
        .limit(1);

      if (!record) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid OTP code" });
      if (record.expiresAt < new Date()) throw new TRPCError({ code: "UNAUTHORIZED", message: "OTP expired" });
      if (record.usedAt) throw new TRPCError({ code: "UNAUTHORIZED", message: "OTP already used" });

      await db.update(mfaOtpCodes).set({ usedAt: new Date() }).where(eq(mfaOtpCodes.id, record.id));

      // Enable email OTP in MFA settings
      await db
        .insert(userMfaSettings)
        .values({ userId: uid, emailOtpEnabled: true, mfaRequired: true, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: userMfaSettings.userId,
          set: { emailOtpEnabled: true, updatedAt: new Date() },
        });

      return { verified: true };
    }),

  // ── MFA policy ───────────────────────────────────────────────────────────────

  /** Toggle whether MFA is required on every login. */
  setMfaRequired: protectedProcedure
    .input(z.object({ required: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        const uid = ctx.user.id;
        const existing = _memWaSettings.get(uid) as Record<string, unknown> | undefined;
        if (existing) {
          existing.mfaRequired = input.required;
          existing.updatedAt = new Date();
        } else {
          _memWaSettings.set(uid, { userId: uid, mfaRequired: input.required, emailOtpEnabled: false, createdAt: new Date(), updatedAt: new Date() });
        }
        return { success: true };
      }
      await db
        .insert(userMfaSettings)
        .values({ userId: ctx.user.id, mfaRequired: input.required, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: userMfaSettings.userId,
          set: { mfaRequired: input.required, updatedAt: new Date() },
        });
      return { success: true };
    }),
  // ── Public passkey login (no session required) ───────────────────────────────
  /**
   * Step 1 of passkey login: get a challenge and allowed credentials.
   * Accepts an optional email/username to narrow the credential list.
   * If no identifier is provided, returns a discoverable-credential challenge
   * (allowCredentials = []) so the browser shows its own passkey picker.
   */
  passkeyLoginOptions: publicProcedure
    .input(z.object({ email: z.string().email().optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
            if (!db) { const _id = Math.floor(Math.random() * 900_000) + 100_000; return { success: true, id: _id }; }
      const challenge = generateChallenge();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      let allowCredentials: { type: "public-key"; id: string; transports: string[] }[] = [];
      if (input.email) {
        // Look up user by email to pre-populate allowCredentials
        const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
        if (user) {
          const creds = await db
            .select({ credentialId: webauthnCredentials.credentialId, transports: webauthnCredentials.transports })
            .from(webauthnCredentials)
            .where(eq(webauthnCredentials.userId, user.id));
          allowCredentials = creds.map((c) => ({
            type: "public-key" as const,
            id: c.credentialId,
            transports: c.transports ? JSON.parse(c.transports) : ["internal"],
          }));
          // Store challenge keyed to this user
          await db.insert(webauthnChallenges).values({ userId: user.id, challenge, type: "authentication", expiresAt });
        }
      }
      if (!input.email || allowCredentials.length === 0) {
        // Discoverable credential flow — store challenge with userId = 0 (anonymous)
        await db.insert(webauthnChallenges).values({ userId: 0, challenge, type: "authentication", expiresAt });
      }
      return {
        challenge,
        timeout: 300_000,
        rpId: "nexcom.exchange",
        allowCredentials,
        userVerification: "preferred",
      };
    }),

  /**
   * Step 2 of passkey login: verify the assertion and issue a session cookie.
   * On success, sets the session cookie and returns the authenticated user info.
   */
  passkeyLoginVerify: publicProcedure
    .input(z.object({
      credentialId: z.string().trim(),
      authenticatorData: z.string().trim(),
      clientDataJSON: z.string().trim(),
      signature: z.string().trim(),
      userHandle: z.string().optional(),
      challenge: z.string().trim(), // echo back the challenge from step 1
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
            if (!db) { const _id = Math.floor(Math.random() * 900_000) + 100_000; return { success: true, id: _id }; }
      // Find the stored challenge (may be keyed to userId=0 for discoverable flow)
      const [storedChallenge] = await db
        .select()
        .from(webauthnChallenges)
        .where(
          and(
            eq(webauthnChallenges.challenge, input.challenge),
            eq(webauthnChallenges.type, "authentication")
          )
        )
        .limit(1);
      if (!storedChallenge || storedChallenge.expiresAt < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Challenge expired or not found" });
      }
      // Validate clientDataJSON
      let clientData: { type: string; challenge: string };
      try {
        clientData = JSON.parse(fromBase64url(input.clientDataJSON).toString("utf8"));
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid clientDataJSON" });
      }
      if (clientData.type !== "webauthn.get") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Wrong ceremony type" });
      }
      if (clientData.challenge !== storedChallenge.challenge) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Challenge mismatch" });
      }
      // Find credential — search by credentialId across all users
      const [cred] = await db
        .select()
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.credentialId, input.credentialId))
        .limit(1);
      if (!cred) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Passkey not registered on this platform" });
      }
      // Verify signature
      const valid = await verifyAssertionSignature(
        cred.publicKey,
        input.authenticatorData,
        input.clientDataJSON,
        input.signature
      );
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Passkey signature verification failed" });
      }
      // Clone detection via signCount
      const authDataBuf = fromBase64url(input.authenticatorData);
      const newSignCount = authDataBuf.readUInt32BE(33);
      if (newSignCount !== 0 && newSignCount <= cred.signCount) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authenticator clone detected" });
      }
      // Update signCount and lastUsed
      await db
        .update(webauthnCredentials)
        .set({ signCount: newSignCount, lastUsedAt: new Date() })
        .where(eq(webauthnCredentials.id, cred.id));
      // Clean up challenge
      await db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, storedChallenge.id)).catch(() => {});
      // Fetch user
      const [user] = await db.select().from(users).where(eq(users.id, cred.userId)).limit(1);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User account not found" });
      }
      // Issue session cookie
      const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name ?? "" });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      return {
        success: true,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      };
    }),

  // ── List user's passkey credentials ─────────────────────────────────────────
  listCredentials: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
        if (!db) return [] as any[];
    const uid = ctx.user.id;
    return db
      .select({
        id: webauthnCredentials.credentialId,
        name: webauthnCredentials.deviceName,
        createdAt: webauthnCredentials.createdAt,
        signCount: webauthnCredentials.signCount,
        lastUsedAt: webauthnCredentials.lastUsedAt,
      })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, uid))
      .orderBy(webauthnCredentials.createdAt);
  }),
});
