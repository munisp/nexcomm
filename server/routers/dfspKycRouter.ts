/**
 * DFSP KYC/AML Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Procedures:
 *   submitKyc      — called by the onboarding wizard on final submit (protected)
 *   listKycRecords — admin: list all DFSP KYC applications with filters
 *   getKycRecord   — admin: get a single KYC record by fspId
 *   reviewKyc      — admin: approve / reject / flag EDD
 */

import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getDb } from "../db";
import { dfspKycRecords } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { writeAuditLog } from "../audit";

const kycInputSchema = z.object({
  fspId:                     z.string().min(2).max(64),
  legalEntityName:           z.string().min(2).max(256),
  registrationNumber:        z.string().min(2).max(128),
  taxId:                     z.string().max(64).optional(),
  regulatoryBody:            z.string().min(2).max(128),
  licenseNumber:             z.string().min(2).max(128),
  amlRiskLevel:              z.enum(["LOW", "MEDIUM", "HIGH"]),
  pepExposure:               z.boolean(),
  sanctionsScreeningPassed:  z.boolean(),
  beneficialOwners:          z.string().min(5),
  complianceOfficerName:     z.string().min(2).max(256),
  complianceOfficerEmail:    z.string().email().max(256),
  documentsProvided:         z.array(z.string().trim()).default([]),
  acknowledgedAmlPolicy:     z.boolean(),
  acknowledgedDataProcessing: z.boolean(),
});

export const dfspKycRouter = router({
  // ── Submit KYC (called from onboarding wizard) ─────────────────────────────
  submitKyc: protectedProcedure
    .input(kycInputSchema)
    .mutation(async ({ input }) => {
      // Upsert: if the DFSP re-submits, update the record and reset to PENDING
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const existing = await db
        .select({ id: dfspKycRecords.id })
        .from(dfspKycRecords)
        .where(eq(dfspKycRecords.fspId, input.fspId))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(dfspKycRecords)
          .set({
            legalEntityName:           input.legalEntityName,
            registrationNumber:        input.registrationNumber,
            taxId:                     input.taxId ?? null,
            regulatoryBody:            input.regulatoryBody,
            licenseNumber:             input.licenseNumber,
            amlRiskLevel:              input.amlRiskLevel,
            pepExposure:               input.pepExposure,
            sanctionsScreeningPassed:  input.sanctionsScreeningPassed,
            beneficialOwners:          input.beneficialOwners,
            complianceOfficerName:     input.complianceOfficerName,
            complianceOfficerEmail:    input.complianceOfficerEmail,
            documentsProvided:         input.documentsProvided,
            acknowledgedAmlPolicy:     input.acknowledgedAmlPolicy,
            acknowledgedDataProcessing: input.acknowledgedDataProcessing,
            status:                    "PENDING",
            reviewedBy:                null,
            reviewedAt:                null,
            reviewNotes:               null,
            updatedAt:                 new Date(),
          })
          .where(eq(dfspKycRecords.fspId, input.fspId));
        return { action: "updated", fspId: input.fspId };
      }

      await db.insert(dfspKycRecords).values({
        fspId:                     input.fspId,
        legalEntityName:           input.legalEntityName,
        registrationNumber:        input.registrationNumber,
        taxId:                     input.taxId ?? null,
        regulatoryBody:            input.regulatoryBody,
        licenseNumber:             input.licenseNumber,
        amlRiskLevel:              input.amlRiskLevel,
        pepExposure:               input.pepExposure,
        sanctionsScreeningPassed:  input.sanctionsScreeningPassed,
        beneficialOwners:          input.beneficialOwners,
        complianceOfficerName:     input.complianceOfficerName,
        complianceOfficerEmail:    input.complianceOfficerEmail,
        documentsProvided:         input.documentsProvided,
        acknowledgedAmlPolicy:     input.acknowledgedAmlPolicy,
        acknowledgedDataProcessing: input.acknowledgedDataProcessing,
        status:                    "PENDING",
      });
      return { action: "created", fspId: input.fspId };
    }),

  // ── List KYC Records (admin) ───────────────────────────────────────────────
  listKycRecords: protectedProcedure
    .input(z.object({
      status: z.enum(["PENDING", "APPROVED", "REJECTED", "EDD_REQUIRED", "ALL"]).default("ALL"),
      search: z.string().optional(),
      limit:  z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const db = await getDb();
      if (!db) return [];
      const baseQuery = db.select().from(dfspKycRecords);
      const rows = await baseQuery.orderBy(desc(dfspKycRecords.createdAt)).limit(input.limit).offset(input.offset);
      type KycRow = typeof rows[number];
      let filtered: KycRow[] = rows;
      if (input.status !== "ALL") {
        filtered = filtered.filter((r: KycRow) => r.status === input.status);
      }
      if (input.search) {
        const q = input.search.toLowerCase();
        filtered = filtered.filter(
          (r: KycRow) =>
            r.fspId.toLowerCase().includes(q) ||
            r.legalEntityName.toLowerCase().includes(q) ||
            r.complianceOfficerEmail.toLowerCase().includes(q)
        );
      }
      return filtered;
    }),

  // ── Get Single KYC Record (admin) ─────────────────────────────────────────
  getKycRecord: protectedProcedure
    .input(z.object({ fspId: z.string().trim() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db
        .select()
        .from(dfspKycRecords)
        .where(eq(dfspKycRecords.fspId, input.fspId))
        .limit(1);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "KYC record not found" });
      return rows[0];
    }),

  // ── Review KYC (admin: approve / reject / EDD) ────────────────────────────
  reviewKyc: protectedProcedure
    .input(z.object({
      fspId:       z.string().trim(),
      status:      z.enum(["APPROVED", "REJECTED", "EDD_REQUIRED"]),
      reviewNotes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db
        .select({ id: dfspKycRecords.id })
        .from(dfspKycRecords)
        .where(eq(dfspKycRecords.fspId, input.fspId))
        .limit(1);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "KYC record not found" });

      await db
        .update(dfspKycRecords)
        .set({
          status:      input.status,
          reviewedBy:  ctx.user.name ?? ctx.user.openId,
          reviewedAt:  new Date(),
          reviewNotes: input.reviewNotes ?? null,
          updatedAt:   new Date(),
        })
        .where(eq(dfspKycRecords.fspId, input.fspId));

      return { success: true, fspId: input.fspId, status: input.status };
    }),

  // ── KYC Summary Stats (admin dashboard widget) ────────────────────────────
  kycStats: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const db = await getDb();
      if (!db) return { total: 0, pending: 0, approved: 0, rejected: 0, eddRequired: 0, highRisk: 0, mediumRisk: 0 };
      const all = await db.select({ status: dfspKycRecords.status, amlRiskLevel: dfspKycRecords.amlRiskLevel }).from(dfspKycRecords);
      type StatRow = { status: string | null; amlRiskLevel: string | null };
      const stats = {
        total:       all.length,
        pending:     all.filter((r: StatRow) => r.status === "PENDING").length,
        approved:    all.filter((r: StatRow) => r.status === "APPROVED").length,
        rejected:    all.filter((r: StatRow) => r.status === "REJECTED").length,
        eddRequired: all.filter((r: StatRow) => r.status === "EDD_REQUIRED").length,
        highRisk:    all.filter((r: StatRow) => r.amlRiskLevel === "HIGH").length,
        mediumRisk:  all.filter((r: StatRow) => r.amlRiskLevel === "MEDIUM").length,
      };
      return stats;
    }),
});
