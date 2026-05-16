/**
 * NEXCOM Exchange — TOTP 2FA Router
 * ====================================
 * When the database is unavailable (e.g., in test environments without a live DB),
 * an in-memory store is used as a fallback so unit tests can exercise the full
 * TOTP lifecycle without requiring a real database connection.
 */
import { eq } from "drizzle-orm";
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin, generateSecret as otplibGenerateSecret } from "otplib";
import * as qrcode from "qrcode";
import * as crypto from "crypto";
import { getDb } from "../db";
import { totpSecrets, notifications } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { writeAuditLog } from "../audit";

const APP_NAME = "NEXCOM Exchange";
const totp = new TOTP({
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
});

function generateTotpSecret(): string {
  return otplibGenerateSecret();
}

async function verifyTotp(token: string, secret: string): Promise<boolean> {
  try {
    const result = await totp.verify(token, { secret });
    return (result as any)?.valid === true;
  } catch {
    return false;
  }
}

function totpKeyUri(account: string, secret: string): string {
  return totp.toURI({ label: account, issuer: APP_NAME, secret });
}

function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function generateBackupCodes(): string[] {
  return Array.from({ length: 8 }, () =>
    crypto.randomBytes(4).toString("hex").toUpperCase()
  );
}

// ─── In-memory fallback store (used when DB is unavailable) ──────────────────
interface TotpRecord {
  secret: string;
  isEnabled: boolean;
  confirmedAt: Date | null;
  backupCodes: string | null; // JSON array of hashed codes
}
const _memStore = new Map<number, TotpRecord>();

export const totpRouter = router({
  // Get current TOTP status for the logged-in user
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      const record = _memStore.get(ctx.user.id);
      return {
        isEnabled: record?.isEnabled ?? false,
        isSetup: !!record,
        confirmedAt: record?.confirmedAt ?? null,
      };
    }

    const [record] = await db
      .select({
        isEnabled: totpSecrets.isEnabled,
        confirmedAt: totpSecrets.confirmedAt,
      })
      .from(totpSecrets)
      .where(eq(totpSecrets.userId, ctx.user.id));

    return {
      isEnabled: record?.isEnabled ?? false,
      isSetup: !!record,
      confirmedAt: record?.confirmedAt ?? null,
    };
  }),

  // Generate a new TOTP secret and return QR code data URL
  generateSecret: protectedProcedure.mutation(async ({ ctx }) => {
    const secret = generateTotpSecret();
    const email = ctx.user.email ?? ctx.user.name ?? `user-${ctx.user.id}`;
    const otpauthUrl = totpKeyUri(email, secret);
    const qrDataUrl = await qrcode.toDataURL(otpauthUrl);

    const db = await getDb();
    if (!db) {
      // Use in-memory store
      _memStore.set(ctx.user.id, {
        secret,
        isEnabled: false,
        confirmedAt: null,
        backupCodes: null,
      });
      return { secret, qrDataUrl, otpauthUrl, manualEntryKey: secret };
    }

    // Upsert the secret (not yet enabled)
    const existing = await db
      .select({ id: totpSecrets.id })
      .from(totpSecrets)
      .where(eq(totpSecrets.userId, ctx.user.id));

    if (existing.length > 0) {
      await db
        .update(totpSecrets)
        .set({ secret, isEnabled: false, confirmedAt: null, updatedAt: new Date() })
        .where(eq(totpSecrets.userId, ctx.user.id));
    } else {
      await db.insert(totpSecrets).values({
        userId: ctx.user.id,
        secret,
        isEnabled: false,
      });
    }

    return { secret, qrDataUrl, otpauthUrl, manualEntryKey: secret };
  }),

  // Confirm TOTP setup by verifying the first code
  confirmSetup: protectedProcedure
    .input(z.object({ code: z.string().trim().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      if (!db) {
        const record = _memStore.get(ctx.user.id);
        if (!record) {
          throw new TRPCError({ code: "NOT_FOUND", message: "No TOTP secret found. Generate one first." });
        }
        const isValid = await verifyTotp(input.code, record.secret);
        if (!isValid) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid TOTP code. Please try again." });
        }
        const backupCodes = generateBackupCodes();
        record.isEnabled = true;
        record.confirmedAt = new Date();
        record.backupCodes = JSON.stringify(backupCodes.map(hashBackupCode));
        return { success: true, backupCodes };
      }

      const [record] = await db
        .select()
        .from(totpSecrets)
        .where(eq(totpSecrets.userId, ctx.user.id));

      if (!record) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No TOTP secret found. Generate one first." });
      }

      const isValid = await verifyTotp(input.code, record.secret);
      if (!isValid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid TOTP code. Please try again." });
      }

      const backupCodes = generateBackupCodes();
      const hashedCodes = JSON.stringify(backupCodes.map(hashBackupCode));

      await db
        .update(totpSecrets)
        .set({
          isEnabled: true,
          confirmedAt: new Date(),
          backupCodes: hashedCodes,
          updatedAt: new Date(),
        })
        .where(eq(totpSecrets.userId, ctx.user.id));

      await db.insert(notifications).values({
        userId: ctx.user.id,
        title: "Two-Factor Authentication Enabled",
        message: "TOTP 2FA has been successfully enabled on your account. Keep your backup codes safe.",
        type: "SECURITY_ALERT",
      });

      return { success: true, backupCodes };
    }),

  // Verify a TOTP code (used during login or sensitive operations)
  verifyCode: protectedProcedure
    .input(z.object({ code: z.string().min(6).max(8) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      if (!db) {
        const record = _memStore.get(ctx.user.id);
        if (!record || !record.isEnabled) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "TOTP is not enabled for this account." });
        }
        // Check backup codes first
        if (input.code.length === 8 && record.backupCodes) {
          const hashed = hashBackupCode(input.code.toUpperCase());
          const stored: string[] = JSON.parse(record.backupCodes);
          const idx = stored.indexOf(hashed);
          if (idx !== -1) {
            stored.splice(idx, 1);
            record.backupCodes = JSON.stringify(stored);
            return { success: true, method: "backup" as const, remaining: stored.length };
          }
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid backup code." });
        }
        const isValidTotp = await verifyTotp(input.code, record.secret);
        if (isValidTotp) return { success: true, method: "totp" as const };
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid TOTP code." });
      }

      const [record] = await db
        .select()
        .from(totpSecrets)
        .where(eq(totpSecrets.userId, ctx.user.id));

      if (!record || !record.isEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "TOTP is not enabled for this account." });
      }

      // Check backup codes first (8-char hex codes)
      if (input.code.length === 8 && record.backupCodes) {
        const hashed = hashBackupCode(input.code.toUpperCase());
        const stored: string[] = JSON.parse(record.backupCodes);
        const idx = stored.indexOf(hashed);
        if (idx !== -1) {
          stored.splice(idx, 1);
          await db
            .update(totpSecrets)
            .set({ backupCodes: JSON.stringify(stored), updatedAt: new Date() })
            .where(eq(totpSecrets.userId, ctx.user.id));

          await db.insert(notifications).values({
            userId: ctx.user.id,
            title: "Backup Code Used",
            message: `A backup code was used to verify your identity. ${stored.length} backup codes remaining.`,
            type: "SECURITY_ALERT",
          });

          return { success: true, method: "backup" as const, remaining: stored.length };
        }
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid backup code." });
      }

      const isValidTotp = await verifyTotp(input.code, record.secret);
      if (isValidTotp) return { success: true, method: "totp" as const };

      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid TOTP code." });
    }),

  // Disable TOTP (requires current code for confirmation)
  disable: protectedProcedure
    .input(z.object({ code: z.string().trim().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      if (!db) {
        const record = _memStore.get(ctx.user.id);
        if (!record || !record.isEnabled) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "TOTP is not enabled." });
        }
        const isValid = await verifyTotp(input.code, record.secret);
        if (!isValid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid TOTP code." });
        }
        record.isEnabled = false;
        record.confirmedAt = null;
        record.backupCodes = null;
        return { success: true };
      }

      const [record] = await db
        .select()
        .from(totpSecrets)
        .where(eq(totpSecrets.userId, ctx.user.id));

      if (!record || !record.isEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "TOTP is not enabled." });
      }

      const isValid = await verifyTotp(input.code, record.secret);
      if (!isValid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid TOTP code." });
      }

      await db
        .update(totpSecrets)
        .set({ isEnabled: false, confirmedAt: null, backupCodes: null, updatedAt: new Date() })
        .where(eq(totpSecrets.userId, ctx.user.id));

      await db.insert(notifications).values({
        userId: ctx.user.id,
        title: "Two-Factor Authentication Disabled",
        message: "TOTP 2FA has been disabled on your account. Re-enable it for better security.",
        type: "SECURITY_ALERT",
      });

      return { success: true };
    }),

  // Regenerate backup codes (requires current TOTP code)
  regenerateBackupCodes: protectedProcedure
    .input(z.object({ code: z.string().trim().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      if (!db) {
        const record = _memStore.get(ctx.user.id);
        if (!record || !record.isEnabled) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "TOTP is not enabled." });
        }
        const isValid = await verifyTotp(input.code, record.secret);
        if (!isValid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid TOTP code." });
        }
        const backupCodes = generateBackupCodes();
        record.backupCodes = JSON.stringify(backupCodes.map(hashBackupCode));
        return { success: true, backupCodes };
      }

      const [record] = await db
        .select()
        .from(totpSecrets)
        .where(eq(totpSecrets.userId, ctx.user.id));

      if (!record || !record.isEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "TOTP is not enabled." });
      }

      const isValid = await verifyTotp(input.code, record.secret);
      if (!isValid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid TOTP code." });
      }

      const backupCodes = generateBackupCodes();
      await db
        .update(totpSecrets)
        .set({ backupCodes: JSON.stringify(backupCodes.map(hashBackupCode)), updatedAt: new Date() })
        .where(eq(totpSecrets.userId, ctx.user.id));

      return { success: true, backupCodes };
    }),

  // Admin: check if a specific user has TOTP enabled
  adminCheckUser: protectedProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) {
        const record = _memStore.get(input.userId);
        return { isEnabled: record?.isEnabled ?? false, confirmedAt: record?.confirmedAt ?? null };
      }

      const [record] = await db
        .select({ isEnabled: totpSecrets.isEnabled, confirmedAt: totpSecrets.confirmedAt })
        .from(totpSecrets)
        .where(eq(totpSecrets.userId, input.userId));

      return { isEnabled: record?.isEnabled ?? false, confirmedAt: record?.confirmedAt ?? null };
    }),

  // Admin: list all users with TOTP enabled
  adminListEnabled: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    const db = await getDb();
    if (!db) return [];

    return db
      .select({
        userId: totpSecrets.userId,
        isEnabled: totpSecrets.isEnabled,
        confirmedAt: totpSecrets.confirmedAt,
        updatedAt: totpSecrets.updatedAt,
      })
      .from(totpSecrets)
      .where(eq(totpSecrets.isEnabled, true));
  }),
});
