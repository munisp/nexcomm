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
  bankFinancingApplications, users, notifications,
} from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function sendWhatsAppMessage(to: string, message: string): Promise<boolean> {
  const channelGatewayUrl = ENV.channelGatewayUrl || "http://localhost:8082";
  const token = ENV.whatsappAccessToken;
  if (!token) {
    console.warn("[WhatsApp] WHATSAPP_ACCESS_TOKEN not set — logging message instead:", { to, message });
    return true; // graceful degradation in dev
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
      referenceNumber: z.string(),
      channel: z.enum(["USSD", "WHATSAPP", "WEB", "MOBILE"]).default("USSD"),
      internalKey: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Validate internal service key
      const expectedKey = ENV.internalSecret || ENV.cookieSecret;
      if (input.internalKey !== expectedKey) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid internal service key" });
      }

      const db = getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Look up user phone number
      const [user] = await db
        .select({ id: users.id, phone: users.phone, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);

      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      // Look up loan details
      const [loan] = await db
        .select({
          id: bankFinancingApplications.id,
          loanAmount: bankFinancingApplications.loanAmount,
          currency: bankFinancingApplications.currency,
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
      const currency = input.currency || loan.currency || "NGN";

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
      const phone = user.phone;
      let whatsappSent = false;
      if (phone) {
        whatsappSent = await sendWhatsAppMessage(phone, receiptMessage);
      }

      // Store notification record
      await db.insert(notifications).values({
        userId: input.userId,
        title: "Loan Repayment Confirmed",
        body: `Your payment of ${formatCurrency(input.amountPaid, currency)} has been received. Ref: ${input.referenceNumber}`,
        type: "LOAN_REPAYMENT",
        isRead: false,
        metadata: JSON.stringify({
          loanId: input.loanId,
          amountPaid: input.amountPaid,
          currency,
          referenceNumber: input.referenceNumber,
          channel: input.channel,
          whatsappSent,
        }),
        createdAt: now,
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

      const db = getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [user] = await db
        .select({ id: users.id, phone: users.phone, name: users.name })
        .from(users)
        .where(eq(users.id, input.targetUserId))
        .limit(1);

      if (!user) throw new TRPCError({ code: "NOT_FOUND" });

      const [loan] = await db
        .select({
          loanAmount: bankFinancingApplications.loanAmount,
          currency: bankFinancingApplications.currency,
        })
        .from(bankFinancingApplications)
        .where(eq(bankFinancingApplications.id, input.loanId))
        .limit(1);

      if (!loan) throw new TRPCError({ code: "NOT_FOUND" });

      const currency = loan.currency || "NGN";
      const message = [
        "🎉 *NEXCOM Exchange — Loan Approved!*",
        "",
        `Dear ${user.name || "Valued Customer"},`,
        "",
        `Congratulations! Your loan application has been approved.`,
        "",
        `💰 *Loan Details*`,
        `• Loan ID: #${input.loanId}`,
        `• Approved Amount: ${formatCurrency(loan.loanAmount, currency)}`,
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
      if (user.phone) {
        whatsappSent = await sendWhatsAppMessage(user.phone, message);
      }

      await db.insert(notifications).values({
        userId: input.targetUserId,
        title: "Loan Application Approved",
        body: `Your loan of ${formatCurrency(loan.loanAmount, currency)} has been approved.`,
        type: "LOAN_APPROVED",
        isRead: false,
        metadata: JSON.stringify({ loanId: input.loanId, whatsappSent }),
        createdAt: Date.now(),
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

      const db = getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [user] = await db
        .select({ id: users.id, phone: users.phone, name: users.name })
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
      if (user.phone) {
        whatsappSent = await sendWhatsAppMessage(user.phone, message);
      }

      await db.insert(notifications).values({
        userId: input.targetUserId,
        title: "Loan Disbursed",
        body: `Your loan of ${formatCurrency(input.disbursedAmount, "NGN")} has been disbursed.`,
        type: "LOAN_DISBURSED",
        isRead: false,
        metadata: JSON.stringify({ loanId: input.loanId, disbursedAmount: input.disbursedAmount, whatsappSent }),
        createdAt: Date.now(),
      });

      return { success: true, whatsappSent };
    }),
});
