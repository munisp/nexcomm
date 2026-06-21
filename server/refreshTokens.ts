/**
 * refreshTokens.ts — PostgreSQL-backed refresh token management
 *
 * Security model:
 *  - Refresh tokens are stored as SHA-256 hashes (never raw)
 *  - Token families detect reuse attacks: if a revoked token is presented,
 *    the entire family is revoked (session hijack mitigation)
 *  - Tokens expire after REFRESH_TTL_MS (7 days)
 *  - Expired tokens are cleaned up lazily on each request
 */

import { createHash, randomBytes } from "crypto";
import { getDb } from "./db";
import { refreshTokens } from "../drizzle/schema";
import { eq, and, lt, isNull } from "drizzle-orm";
import { REFRESH_TTL_MS } from "@shared/const";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function generateRawToken(): string {
  return randomBytes(48).toString("base64url");
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Issue a new refresh token for a user.
 * Returns the raw token (to be sent as HttpOnly cookie) and its family ID.
 */
export async function issueRefreshToken(
  userId: number,
  opts: { ip?: string; userAgent?: string; family?: string } = {}
): Promise<{ raw: string; family: string } | null> {
  const db = await getDb();
  if (!db) return null;

  const raw = generateRawToken();
  const family = opts.family ?? randomBytes(16).toString("hex");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  try {
    await db.insert(refreshTokens).values({
      userId,
      tokenHash,
      family,
      expiresAt,
      issuedIp: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
    });
    return { raw, family };
  } catch {
    return null;
  }
}

/**
 * Validate a refresh token.
 * Returns the userId and family if valid, null otherwise.
 * Automatically revokes the used token (rotation).
 */
export async function consumeRefreshToken(
  rawToken: string
): Promise<{ userId: number; family: string } | null> {
  const db = await getDb();
  if (!db) return null;

  const tokenHash = hashToken(rawToken);

  try {
    const rows = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    const token = rows[0];
    if (!token) return null;

    // Token already revoked — reuse attack detected!
    if (token.revokedAt !== null) {
      // Revoke entire family to invalidate all sessions from this family
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.family, token.family),
            isNull(refreshTokens.revokedAt)
          )
        );
      console.warn(
        `[RefreshToken] Reuse attack detected for family ${token.family}, userId ${token.userId} — entire family revoked`
      );
      return null;
    }

    // Token expired
    if (token.expiresAt < new Date()) {
      return null;
    }

    // Revoke the used token (rotation — one-time use)
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash));

    return { userId: token.userId, family: token.family };
  } catch {
    return null;
  }
}

/**
 * Revoke all refresh tokens for a user (logout all devices).
 */
export async function revokeAllRefreshTokens(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt))
      );
  } catch {
    // Silently fail — logout still proceeds via cookie clear
  }
}

/**
 * Revoke all tokens in a specific family (session hijack response).
 */
export async function revokeFamilyTokens(family: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(refreshTokens.family, family), isNull(refreshTokens.revokedAt))
      );
  } catch {}
}

/**
 * Clean up expired tokens (call periodically to keep table small).
 */
export async function purgeExpiredRefreshTokens(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    const result = await db
      .delete(refreshTokens)
      .where(lt(refreshTokens.expiresAt, new Date()));
    return (result as unknown as { rowCount?: number })?.rowCount ?? 0;
  } catch {
    return 0;
  }
}
