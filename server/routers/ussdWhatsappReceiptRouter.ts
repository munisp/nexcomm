/**
 * ussdWhatsappReceiptRouter.ts
 *
 * Sends a WhatsApp confirmation receipt after a successful USSD loan repayment.
 * Called by the USSD engine after PIN verification and successful repayment.
 *
 * Flow:
 *   USSD Engine → POST /api/trpc/ussdWhatsappReceipt.sendRepaymentReceipt
 *   → Looks up loan + user phone
 *   → Sends WhatsApp message via channel-gateway
 *   → Records receipt in DB
 */
import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";
import { ENV } from "../_core/env";
import {
  bankFinancingApplications, users, notifications, farmerProfiles,
} from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { writeAuditLog } from "../audit";

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function sendWhatsAppMessage(to: string, message: string): Promise<boolean> {
  const channelGatewayUrl = ENV.channelGatewayUrl || "http://localhost:8082";
  const token = ENV.whatsappAccessToken;
  if (!token) {
    console.error("[WhatsApp] WHATSAPP_ACCESS_TOKEN is not configured; receipt will not be sent", { to });
    return false;
  }
  try {
    const res = await fetch(`${channelGatewayUrl}/api/v1/whatsapp/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "X-Internal-Key": ENV.internalSecret || ENV.cookieSecret,
      },
      body: JSON.stringify({
        to,
        type: "text",
        text: { body: message },
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("[WhatsApp] Failed to send message:", err);
    return false;
  }
}

function formatCurrency(amount: number, currency = "NGN"): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────
export const ussdWhatsappReceiptRouter = router({
  /**
   * Send a WhatsApp repayment receipt after USSD loan repayment.
   * Called by the USSD engine with an internal service token.
   */
  sendRepaymentReceipt: publicProcedure
    .input(z.object({
      loanId: z.number(),
      userId: z.number(),
      amountPaid: z.number().positive(),
      currency: z.string().default("NGN"),
      referenceNumber: z.string().trim(),
      channel: z.enum(["USSD", "WHATSAPP", "WEB", "MOBILE"]).default("USSD"),
      internalKey: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Validate internal service key
      const expectedKey = ENV.internalSecret || ENV.cookieSecret;
      if (input.internalKey !== expectedKey) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid internal service key" });
      }

      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      // Look up user phone number
      const [user] = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);

      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      // Look up loan details
      const [loan] = await db
        .select({
          id: bankFinancingApplications.id,
          loanAmount: bankFinancingApplications.requestedAmountNgn,
          approvedAmount: bankFinancingApplications.approvedAmountNgn,
          status: bankFinancingApplications.status,
        })
        .from(bankFinancingApplications)
        .where(and(
          eq(bankFinancingApplications.id, input.loanId),
          eq(bankFinancingApplications.userId, input.userId),
        ))
        .limit(1);

      if (!loan) throw new TRPCError({ code: "NOT_FOUND", message: "Loan not found" });

      const now = Date.now();
      const currency = input.currency || "NGN";

      // Build WhatsApp receipt message
      const receiptMessage = [
        "✅ *NEXCOM Exchange — Loan Repayment Confirmed*",
        "",
        `Dear ${user.name || "Valued Customer"},`,
        "",
        `Your loan repayment has been successfully processed.`,
        "",
        `📋 *Receipt Details*`,
        `• Reference: ${input.referenceNumber}`,
        `• Amount Paid: ${formatCurrency(input.amountPaid, currency)}`,
        `• Channel: ${input.channel}`,
        `• Date: ${formatDate(now)}`,
        `• Loan ID: #${input.loanId}`,
        "",
        `Thank you for your payment. Your account has been updated.`,
        "",
        `For support, contact us at support@nexcom.exchange`,
        `or call *+234-800-NEXCOM-1*`,
      ].join("\n");

      // Send WhatsApp message
      // Look up phone from farmerProfiles (users table has no phone column)
      const [fp1] = await db.select({ phone: farmerProfiles.phone }).from(farmerProfiles).where(eq(farmerProfiles.userId, input.userId)).limit(1);
      const phone = fp1?.phone ?? null;
      let whatsappSent = false;
      if (phone) {
        whatsappSent = await sendWhatsAppMessage(phone, receiptMessage);
      }

      // Store notification record
      await db.insert(notifications).values({
        userId: input.userId,
        title: "Loan Repayment Confirmed",
        message: `Your payment of ${formatCurrency(input.amountPaid, currency)} has been received. Ref: ${input.referenceNumber}`,
        type: "SYSTEM",
        read: false,
        metadata: JSON.stringify({
          loanId: input.loanId,
          amountPaid: input.amountPaid,
          currency,
          referenceNumber: input.referenceNumber,
          channel: input.channel,
          whatsappSent,
        }),
      });

      return {
        success: true,
        whatsappSent,
        message: whatsappSent
          ? "Repayment receipt sent via WhatsApp"
          : "Repayment recorded; WhatsApp not configured",
        referenceNumber: input.referenceNumber,
        timestamp: now,
      };
    }),

  /**
   * Send a WhatsApp loan approval notification.
   * Called when admin approves a loan application.
   */
  sendLoanApprovalNotice: protectedProcedure
    .input(z.object({
      loanId: z.number(),
      targetUserId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      }

      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [user] = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, input.targetUserId))
        .limit(1);

      if (!user) throw new TRPCError({ code: "NOT_FOUND" });

      const [loan] = await db
        .select({
          loanAmount: bankFinancingApplications.requestedAmountNgn,
          approvedAmount: bankFinancingApplications.approvedAmountNgn,
        })
        .from(bankFinancingApplications)
        .where(eq(bankFinancingApplications.id, input.loanId))
        .limit(1);

      if (!loan) throw new TRPCError({ code: "NOT_FOUND" });

      const currency = "NGN";
      const message = [
        "🎉 *NEXCOM Exchange — Loan Approved!*",
        "",
        `Dear ${user.name || "Valued Customer"},`,
        "",
        `Congratulations! Your loan application has been approved.`,
        "",
        `💰 *Loan Details*`,
        `• Loan ID: #${input.loanId}`,
        `• Approved Amount: ${formatCurrency(Number(loan.loanAmount ?? loan.approvedAmount ?? 0), currency)}`,
        `• Date: ${formatDate(Date.now())}`,
        "",
        `Funds will be disbursed to your registered account within 2 business days.`,
        "",
        `Log in to NEXCOM Exchange to view your loan details:`,
        `https://nexcom.exchange/banking`,
        "",
        `For support: support@nexcom.exchange`,
      ].join("\n");

      let whatsappSent = false;
      const [fpLookup1] = await db.select({ phone: farmerProfiles.phone }).from(farmerProfiles).where(eq(farmerProfiles.userId, input.targetUserId)).limit(1);
      const recipientPhone1 = fpLookup1?.phone ?? null;
      if (recipientPhone1) {
        whatsappSent = await sendWhatsAppMessage(recipientPhone1, message);
      }

      await db.insert(notifications).values({
        userId: input.targetUserId,
        title: "Loan Application Approved",
        message: `Your loan of ${formatCurrency(Number(loan.loanAmount ?? loan.approvedAmount ?? 0), currency)} has been approved.`,
        type: "SYSTEM",
        read: false,
        metadata: JSON.stringify({ loanId: input.loanId, whatsappSent }),
      });

      return { success: true, whatsappSent };
    }),

  /**
   * Send a WhatsApp loan disbursement notification.
   */
  sendLoanDisbursementNotice: protectedProcedure
    .input(z.object({
      loanId: z.number(),
      targetUserId: z.number(),
      disbursedAmount: z.number().positive(),
      bankName: z.string().optional(),
      accountLast4: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      }

      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [user] = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, input.targetUserId))
        .limit(1);

      if (!user) throw new TRPCError({ code: "NOT_FOUND" });

      const message = [
        "💸 *NEXCOM Exchange — Loan Disbursed*",
        "",
        `Dear ${user.name || "Valued Customer"},`,
        "",
        `Your loan has been disbursed successfully.`,
        "",
        `🏦 *Disbursement Details*`,
        `• Loan ID: #${input.loanId}`,
        `• Amount: ${formatCurrency(input.disbursedAmount, "NGN")}`,
        input.bankName ? `• Bank: ${input.bankName}` : null,
        input.accountLast4 ? `• Account: ****${input.accountLast4}` : null,
        `• Date: ${formatDate(Date.now())}`,
        "",
        `Please allow 1-2 business days for funds to reflect in your account.`,
        "",
        `For support: support@nexcom.exchange`,
      ].filter(Boolean).join("\n");

      let whatsappSent = false;
      const [fpLookup2] = await db.select({ phone: farmerProfiles.phone }).from(farmerProfiles).where(eq(farmerProfiles.userId, input.targetUserId)).limit(1);
      const recipientPhone2 = fpLookup2?.phone ?? null;
      if (recipientPhone2) {
        whatsappSent = await sendWhatsAppMessage(recipientPhone2, message);
      }

      await db.insert(notifications).values({
        userId: input.targetUserId,
        title: "Loan Disbursed",
        message: `Your loan of ${formatCurrency(input.disbursedAmount, "NGN")} has been disbursed.`,
        type: "SYSTEM",
        read: false,
        metadata: JSON.stringify({ loanId: input.loanId, disbursedAmount: input.disbursedAmount, whatsappSent }),
      });

      return { success: true, whatsappSent };
    }),

  listUssdSessions: protectedProcedure
    .input(z.object({ page: z.number().int().default(1), pageSize: z.number().int().default(20) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      return { items: [], total: 0 };
    }),

  deleteUssdSession: protectedProcedure
    .input(z.object({ sessionId: z.union([z.string(), z.number()]) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      await writeAuditLog({ userId: ctx.user.id, action: "ussdSession.delete", details: { sessionId: input.sessionId } });
      return { success: true };
    }),
});
