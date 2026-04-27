/**
 * NEXCOM Exchange — User Preferences Router
 * Manages per-user currency, language, theme, and timezone preferences.
 * Idempotent: upsert on userId ensures no duplicate rows.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { userPreferences } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { writeAuditLog } from "../audit";

const SUPPORTED_CURRENCIES = ["NGN", "USD", "EUR", "GBP", "GHS", "KES", "ZAR", "XOF"] as const;
const SUPPORTED_LANGUAGES = ["en", "yo", "ig", "ha", "pcm"] as const; // en, Yoruba, Igbo, Hausa, Pidgin

export const preferencesRouter = router({
  /** Get current user preferences (returns defaults if not set) */
  get: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { currency: "NGN", language: "en", theme: "dark", timezone: "Africa/Lagos" };
    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, ctx.user.id))
      .limit(1);
    return prefs ?? { currency: "NGN", language: "en", theme: "dark", timezone: "Africa/Lagos" };
  }),

  /** Update user preferences — idempotent upsert */
  update: protectedProcedure
    .input(z.object({
      currency: z.enum(SUPPORTED_CURRENCIES).optional(),
      language: z.enum(SUPPORTED_LANGUAGES).optional(),
      theme: z.enum(["light", "dark", "system"]).optional(),
      timezone: z.string().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const existing = await db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, ctx.user.id))
        .limit(1);

      if (existing.length > 0) {
        const [updated] = await db
          .update(userPreferences)
          .set({
            ...(input.currency && { currency: input.currency }),
            ...(input.language && { language: input.language }),
            ...(input.theme && { theme: input.theme }),
            ...(input.timezone && { timezone: input.timezone }),
            updatedAt: new Date(),
          })
          .where(eq(userPreferences.userId, ctx.user.id))
          .returning();
        return updated;
      } else {
        const [created] = await db
          .insert(userPreferences)
          .values({
            userId: ctx.user.id,
            currency: input.currency ?? "NGN",
            language: input.language ?? "en",
            theme: input.theme ?? "dark",
            timezone: input.timezone ?? "Africa/Lagos",
          })
          .returning();
        return created;
      }
    }),

  /** List supported currencies with exchange rates vs NGN */
  currencies: protectedProcedure.query(async () => {
    // Exchange rates relative to NGN (base currency)
    // In production these would come from a live FX API
    return [
      { code: "NGN", name: "Nigerian Naira",       symbol: "₦",  rateToNGN: 1 },
      { code: "USD", name: "US Dollar",             symbol: "$",  rateToNGN: 1620 },
      { code: "EUR", name: "Euro",                  symbol: "€",  rateToNGN: 1750 },
      { code: "GBP", name: "British Pound",         symbol: "£",  rateToNGN: 2050 },
      { code: "GHS", name: "Ghanaian Cedi",         symbol: "₵",  rateToNGN: 112 },
      { code: "KES", name: "Kenyan Shilling",       symbol: "KSh",rateToNGN: 12.5 },
      { code: "ZAR", name: "South African Rand",    symbol: "R",  rateToNGN: 88 },
      { code: "XOF", name: "West African CFA Franc",symbol: "CFA",rateToNGN: 2.65 },
    ];
  }),

  /** Get notification preferences */
  getNotifPrefs: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const defaults = {
      notifTradeExecutions: true, notifPriceAlerts: true, notifEwrUpdates: true,
      notifDepositUpdates: true, notifDeliveryUpdates: true, notifSystemMessages: false,
      notifEmail: true, notifSms: false, notifPush: true,
    };
    if (!db) return defaults;
    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, ctx.user.id))
      .limit(1);
    if (!prefs) return defaults;
    return {
      notifTradeExecutions: prefs.notifTradeExecutions,
      notifPriceAlerts:     prefs.notifPriceAlerts,
      notifEwrUpdates:      prefs.notifEwrUpdates,
      notifDepositUpdates:  prefs.notifDepositUpdates,
      notifDeliveryUpdates: prefs.notifDeliveryUpdates,
      notifSystemMessages:  prefs.notifSystemMessages,
      notifEmail:           prefs.notifEmail,
      notifSms:             prefs.notifSms,
      notifPush:            prefs.notifPush,
    };
  }),

  /** Update notification preferences — idempotent upsert */
  updateNotifPrefs: protectedProcedure
    .input(z.object({
      notifTradeExecutions: z.boolean().optional(),
      notifPriceAlerts:     z.boolean().optional(),
      notifEwrUpdates:      z.boolean().optional(),
      notifDepositUpdates:  z.boolean().optional(),
      notifDeliveryUpdates: z.boolean().optional(),
      notifSystemMessages:  z.boolean().optional(),
      notifEmail:           z.boolean().optional(),
      notifSms:             z.boolean().optional(),
      notifPush:            z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const existing = await db
        .select({ id: userPreferences.id })
        .from(userPreferences)
        .where(eq(userPreferences.userId, ctx.user.id))
        .limit(1);
      const patch: Record<string, boolean | Date> = { updatedAt: new Date() };
      if (input.notifTradeExecutions !== undefined) patch.notifTradeExecutions = input.notifTradeExecutions;
      if (input.notifPriceAlerts     !== undefined) patch.notifPriceAlerts     = input.notifPriceAlerts;
      if (input.notifEwrUpdates      !== undefined) patch.notifEwrUpdates      = input.notifEwrUpdates;
      if (input.notifDepositUpdates  !== undefined) patch.notifDepositUpdates  = input.notifDepositUpdates;
      if (input.notifDeliveryUpdates !== undefined) patch.notifDeliveryUpdates = input.notifDeliveryUpdates;
      if (input.notifSystemMessages  !== undefined) patch.notifSystemMessages  = input.notifSystemMessages;
      if (input.notifEmail           !== undefined) patch.notifEmail           = input.notifEmail;
      if (input.notifSms             !== undefined) patch.notifSms             = input.notifSms;
      if (input.notifPush            !== undefined) patch.notifPush            = input.notifPush;
      if (existing.length > 0) {
        await db.update(userPreferences).set(patch).where(eq(userPreferences.userId, ctx.user.id));
      } else {
        await db.insert(userPreferences).values({ userId: ctx.user.id, ...patch });
      }
      return { ok: true };
    }),

  /** List supported languages */
  languages: protectedProcedure.query(async () => {
    return [
      { code: "en",  name: "English",          nativeName: "English" },
      { code: "yo",  name: "Yoruba",           nativeName: "Yorùbá" },
      { code: "ig",  name: "Igbo",             nativeName: "Igbo" },
      { code: "ha",  name: "Hausa",            nativeName: "Hausa" },
      { code: "pcm", name: "Nigerian Pidgin",  nativeName: "Naija Pidgin" },
    ];
  }),
});
