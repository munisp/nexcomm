/**
 * NEXCOM Exchange — KYB (Know Your Business) Router (FIX-KYB)
 * ─────────────────────────────────────────────────────────────────────────────
 * End-to-end corporate onboarding workflow backed by Postgres
 * (drizzle/schema-kyb.ts, migration 0070_kyb_workflows.sql):
 *
 *  Applicant: submitKybApplication → uploadKybDocument → add/remove
 *             directors & beneficial owners → requestScreening → getKybStatus
 *  Admin:     adminListKybApplications → adminGetKybApplication →
 *             adminReviewKyb (APPROVED/REJECTED/EDD_REQUIRED) →
 *             escalateToEdd → adminSuspendKyb
 *
 * Compliance rules enforced:
 *  • CBN UBO threshold — every beneficial owner ≥25% is auto-flagged isUbo;
 *    applications where declared ownership sums to <100% with no ≥25% owner
 *    are flagged as POSSIBLE_UNDECLARED_UBO for the reviewer.
 *  • CAC RC/BN number format validation + manual-review checklist via
 *    server/services/cacVerification.ts (never fabricates registry results).
 *  • Fail-closed screening — if the kyc-service KYB screening endpoint is
 *    unreachable the application stays in SCREENING and can never be
 *    auto-approved; approval requires a completed screening.
 *  • BVN/NIN are stored only as SHA-256 hashes.
 *  • Multi-table writes are transactional; every status transition writes a
 *    kybAuditLog row and (for decisions) an applicant notification.
 */
import { z } from "zod";
import { createHash } from "crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { notifyOwner } from "../_core/notification";
import { storagePut } from "../storage";
import { validateFileUpload } from "../security-middleware";
import { writeAuditLog } from "../audit";
import {
  brokerProfiles,
  notifications,
  traderProfiles,
  users,
} from "../../drizzle/schema";
import {
  KYB_DOC_SLOT_TO_FIELD,
  KYB_DOCUMENT_SLOTS,
  kybApplications,
  kybAuditLog,
  kybBeneficialOwners,
  kybDirectors,
  userKycTiers,
  type KybApplication,
  type KybDocuments,
} from "../../drizzle/schema-kyb";
import {
  validateCacRcNumber,
  validateTin,
  verifyCacRegistration,
} from "../services/cacVerification";

const KYC_SERVICE_URL = process.env.KYC_SERVICE_URL ?? "http://localhost:3002";
const SCREENING_TIMEOUT_MS = 20000;

/** Statuses where the applicant still owns the application (editable). */
const APPLICANT_EDITABLE_STATUSES = ["DRAFT", "SUBMITTED"] as const;
/** Statuses that count as an "active" application for dedup purposes. */
const ACTIVE_STATUSES = ["DRAFT", "SUBMITTED", "SCREENING", "UNDER_REVIEW", "EDD_REQUIRED"] as const;
/** Statuses from which an admin may issue APPROVED/REJECTED decisions. */
const REVIEWABLE_STATUSES = ["UNDER_REVIEW", "EDD_REQUIRED"] as const;

const CBN_UBO_THRESHOLD = 25; // Central Bank of Nigeria UBO ownership threshold (%)

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** SHA-256 hash for BVN/NIN — raw government IDs are never persisted. */
function hashGovId(value: string): string {
  return createHash("sha256").update(`nexcom-kyb:${value.trim()}`).digest("hex");
}

async function getApplicationForUser(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number) {
  const [app] = await db
    .select()
    .from(kybApplications)
    .where(eq(kybApplications.userId, userId))
    .orderBy(desc(kybApplications.createdAt))
    .limit(1);
  return app ?? null;
}

function assertApplicantEditable(app: KybApplication) {
  if (!(APPLICANT_EDITABLE_STATUSES as readonly string[]).includes(app.status)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Application is ${app.status} and can no longer be edited by the applicant.`,
    });
  }
}

/** Map kyc-service risk levels onto the portal enum (CRITICAL → PROHIBITED). */
function mapServiceRiskLevel(level: string | undefined): "LOW" | "MEDIUM" | "HIGH" | "PROHIBITED" {
  switch ((level ?? "").toUpperCase()) {
    case "LOW": return "LOW";
    case "MEDIUM": return "MEDIUM";
    case "HIGH": return "HIGH";
    case "CRITICAL":
    case "PROHIBITED": return "PROHIBITED";
    default: return "MEDIUM"; // unknown → conservative
  }
}

async function writeKybAudit(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  entry: {
    kybApplicationId: number;
    action: string;
    performedBy?: number | null;
    previousStatus?: string | null;
    newStatus?: string | null;
    notes?: string | null;
  },
) {
  await db.insert(kybAuditLog).values({
    kybApplicationId: entry.kybApplicationId,
    action: entry.action,
    performedBy: entry.performedBy ?? null,
    previousStatus: entry.previousStatus ?? null,
    newStatus: entry.newStatus ?? null,
    notes: entry.notes ?? null,
  });
}

async function notifyApplicant(userId: number, title: string, message: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(notifications).values({ userId, title, message, type: "KYC" });
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const directorInput = z.object({
  fullName: z.string().min(2).max(200),
  role: z.string().min(2).max(100).default("Director"),
  appointmentDate: dateString.optional(),
  bvn: z.string().regex(/^\d{11}$/, "BVN must be 11 digits").optional(),
  nin: z.string().regex(/^\d{11}$/, "NIN must be 11 digits").optional(),
  idDocumentUrl: z.string().url().optional(),
});

const beneficialOwnerInput = z.object({
  fullName: z.string().min(2).max(200),
  dateOfBirth: dateString.optional(),
  nationality: z.string().min(2).max(100).default("Nigerian"),
  bvn: z.string().regex(/^\d{11}$/, "BVN must be 11 digits").optional(),
  nin: z.string().regex(/^\d{11}$/, "NIN must be 11 digits").optional(),
  ownershipPercent: z.number().min(0.01).max(100),
  isPep: z.boolean().default(false),
  pepDetails: z.string().max(2000).optional(),
  idDocumentUrl: z.string().url().optional(),
});

const submitInput = z.object({
  businessName: z.string().min(2).max(256),
  businessType: z.enum(["SOLE_PROP", "LLC", "PLC", "COOPERATIVE", "PARTNERSHIP", "NGO"]),
  cacRcNumber: z.string().min(3).max(32),
  tinNumber: z.string().max(20).optional(),
  incorporationDate: dateString.optional(),
  registeredAddress: z.string().min(5).max(1000),
  operatingStates: z.array(z.string().min(2).max(100)).max(40).optional(),
  websiteUrl: z.string().url().max(256).optional(),
  contactEmail: z.string().email().max(200),
  contactPhone: z.string().min(7).max(30),
  expectedMonthlyVolume: z.number().min(0).optional(),
  directors: z.array(directorInput).min(1, "At least one director is required").max(50),
  beneficialOwners: z.array(beneficialOwnerInput).min(1, "At least one beneficial owner is required").max(50),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const kybRouter = router({
  // ── submitKybApplication ────────────────────────────────────────────────────
  submitKybApplication: protectedProcedure
    .input(submitInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });

      // 1. CAC RC/BN format validation (fail fast, before any writes)
      const rcFormat = validateCacRcNumber(input.cacRcNumber);
      if (!rcFormat.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: rcFormat.reason ?? "Invalid CAC RC number" });
      }
      if (input.tinNumber) {
        const tinFormat = validateTin(input.tinNumber);
        if (!tinFormat.valid) {
          throw new TRPCError({ code: "BAD_REQUEST", message: tinFormat.reason ?? "Invalid TIN" });
        }
        input.tinNumber = tinFormat.normalized;
      }

      // 2. UBO ownership rules (CBN ≥25% threshold)
      const totalOwnership = input.beneficialOwners.reduce((sum, o) => sum + o.ownershipPercent, 0);
      if (totalOwnership > 100.0001) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Total beneficial ownership (${totalOwnership.toFixed(2)}%) exceeds 100%.`,
        });
      }
      const uboWarnings: string[] = [];
      const declaredUbos = input.beneficialOwners.filter((o) => o.ownershipPercent >= CBN_UBO_THRESHOLD);
      if (declaredUbos.length === 0) {
        uboWarnings.push(
          `No declared beneficial owner holds ≥${CBN_UBO_THRESHOLD}%. Under CBN AML/CFT rules every ` +
          `≥${CBN_UBO_THRESHOLD}% owner must be declared — flagged for reviewer verification.`,
        );
      }
      if (totalOwnership < 100) {
        uboWarnings.push(
          `Declared ownership totals ${totalOwnership.toFixed(2)}% (< 100%). Remaining ${(100 - totalOwnership).toFixed(2)}% ` +
          `is unaccounted for — reviewer must confirm whether any undeclared ≥${CBN_UBO_THRESHOLD}% owner exists.`,
        );
      }

      // 3. Dedup: one active application per user
      const [existing] = await db
        .select({ id: kybApplications.id, status: kybApplications.status })
        .from(kybApplications)
        .where(and(
          eq(kybApplications.userId, ctx.user.id),
          inArray(kybApplications.status, [...ACTIVE_STATUSES]),
        ))
        .limit(1);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `An active KYB application (#${existing.id}, status ${existing.status}) already exists for this account.`,
        });
      }

      // 4. CAC verification via the configured provider (default: manual review queue)
      const cacVerification = await verifyCacRegistration({
        rcNumber: rcFormat.normalized!,
        businessName: input.businessName,
        businessType: input.businessType,
        incorporationDate: input.incorporationDate ?? null,
      });
      if (cacVerification.status === "FORMAT_INVALID") {
        throw new TRPCError({ code: "BAD_REQUEST", message: cacVerification.notes ?? "CAC number failed validation" });
      }

      // 5. Transactional write: application + directors + UBOs + audit trail
      const created = await db.transaction(async (tx) => {
        const [app] = await tx
          .insert(kybApplications)
          .values({
            userId: ctx.user.id,
            businessName: input.businessName,
            businessType: input.businessType,
            cacRcNumber: rcFormat.normalized,
            tinNumber: input.tinNumber ?? null,
            incorporationDate: input.incorporationDate ? new Date(input.incorporationDate) : null,
            registeredAddress: input.registeredAddress,
            operatingStates: input.operatingStates ?? null,
            websiteUrl: input.websiteUrl ?? null,
            contactEmail: input.contactEmail,
            contactPhone: input.contactPhone,
            expectedMonthlyVolume:
              input.expectedMonthlyVolume !== undefined ? String(input.expectedMonthlyVolume) : null,
            status: "SUBMITTED",
            screeningResult: {
              cacVerification: {
                status: cacVerification.status,
                provider: cacVerification.provider,
                checklist: cacVerification.checklist,
                notes: cacVerification.notes ?? null,
                verifiedAt: cacVerification.verifiedAt.toISOString(),
              },
              uboWarnings,
            },
          })
          .returning();

        await tx.insert(kybDirectors).values(
          input.directors.map((d) => ({
            kybApplicationId: app.id,
            fullName: d.fullName,
            role: d.role,
            appointmentDate: d.appointmentDate ? new Date(d.appointmentDate) : null,
            bvnHash: d.bvn ? hashGovId(d.bvn) : null,
            ninHash: d.nin ? hashGovId(d.nin) : null,
            idDocumentUrl: d.idDocumentUrl ?? null,
          })),
        );

        await tx.insert(kybBeneficialOwners).values(
          input.beneficialOwners.map((o) => ({
            kybApplicationId: app.id,
            fullName: o.fullName,
            dateOfBirth: o.dateOfBirth ? new Date(o.dateOfBirth) : null,
            nationality: o.nationality,
            bvnHash: o.bvn ? hashGovId(o.bvn) : null,
            ninHash: o.nin ? hashGovId(o.nin) : null,
            ownershipPercent: String(o.ownershipPercent),
            isUbo: o.ownershipPercent >= CBN_UBO_THRESHOLD,
            isPep: o.isPep,
            pepDetails: o.isPep ? (o.pepDetails ?? null) : null,
            idDocumentUrl: o.idDocumentUrl ?? null,
          })),
        );

        await tx.insert(kybAuditLog).values({
          kybApplicationId: app.id,
          action: "APPLICATION_SUBMITTED",
          performedBy: ctx.user.id,
          previousStatus: null,
          newStatus: "SUBMITTED",
          notes:
            `Directors: ${input.directors.length}; beneficial owners: ${input.beneficialOwners.length} ` +
            `(${declaredUbos.length} ≥${CBN_UBO_THRESHOLD}%); CAC check: ${cacVerification.status} via ${cacVerification.provider}.` +
            (uboWarnings.length ? ` UBO warnings: ${uboWarnings.join(" | ")}` : ""),
        });

        return app;
      });

      writeAuditLog({
        userId: ctx.user.id,
        action: "KYB_APPLICATION_SUBMITTED",
        resource: "kyb_applications",
        resourceId: String(created.id),
        details: { businessName: input.businessName, cacRcNumber: rcFormat.normalized },
      });
      notifyOwner({
        title: "[KYB] New corporate application submitted",
        content:
          `KYB application #${created.id} ("${input.businessName}", ${input.businessType}, RC ${rcFormat.normalized}) ` +
          `submitted by user ${ctx.user.id}. Screening + review required at /admin/kyb-review.`,
      }).catch((e) => console.warn("[kybRouter] notifyOwner failed:", (e as Error).message));

      return {
        applicationId: created.id,
        status: created.status,
        cacVerificationStatus: cacVerification.status,
        uboWarnings,
      };
    }),

  // ── uploadKybDocument ───────────────────────────────────────────────────────
  uploadKybDocument: protectedProcedure
    .input(z.object({
      docSlot: z.enum(KYB_DOCUMENT_SLOTS),
      fileName: z.string().min(1).max(200),
      mimeType: z.string().min(1).max(100),
      base64Data: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const app = await getApplicationForUser(db, ctx.user.id);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "No KYB application found. Submit an application first." });
      if (["APPROVED", "REJECTED", "SUSPENDED"].includes(app.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot upload documents to a ${app.status} application.` });
      }

      const buffer = Buffer.from(input.base64Data, "base64");
      if (buffer.length > 10 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "File must be under 10 MB" });
      }
      // ── Ransomware / malware file validation ──────────────────────────────
      const fileValidation = validateFileUpload(input.fileName ?? "upload", buffer, input.mimeType);
      if (!fileValidation.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `File rejected: ${fileValidation.reason}` });
      }
      const ext = input.fileName.split(".").pop() ?? "bin";
      const fileKey = `kyb/${ctx.user.id}/${app.id}/${input.docSlot}-${Date.now().toString(36)}.${ext}`;
      const { url } = await storagePut(fileKey, buffer, input.mimeType);

      const field = KYB_DOC_SLOT_TO_FIELD[input.docSlot];
      const documents: KybDocuments = { ...(app.documents ?? {}), [field]: url };
      await db
        .update(kybApplications)
        .set({ documents, updatedAt: new Date() })
        .where(eq(kybApplications.id, app.id));
      await writeKybAudit(db, {
        kybApplicationId: app.id,
        action: "DOCUMENT_UPLOADED",
        performedBy: ctx.user.id,
        previousStatus: app.status,
        newStatus: app.status,
        notes: `Document slot '${input.docSlot}' uploaded.`,
      });
      return { url, docSlot: input.docSlot };
    }),

  // ── addDirector ─────────────────────────────────────────────────────────────
  addDirector: protectedProcedure
    .input(directorInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const app = await getApplicationForUser(db, ctx.user.id);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "No KYB application found" });
      assertApplicantEditable(app);
      const [director] = await db.insert(kybDirectors).values({
        kybApplicationId: app.id,
        fullName: input.fullName,
        role: input.role,
        appointmentDate: input.appointmentDate ? new Date(input.appointmentDate) : null,
        bvnHash: input.bvn ? hashGovId(input.bvn) : null,
        ninHash: input.nin ? hashGovId(input.nin) : null,
        idDocumentUrl: input.idDocumentUrl ?? null,
      }).returning();
      await writeKybAudit(db, {
        kybApplicationId: app.id, action: "DIRECTOR_ADDED", performedBy: ctx.user.id,
        previousStatus: app.status, newStatus: app.status, notes: `Director '${input.fullName}' added.`,
      });
      return director;
    }),

  // ── removeDirector ──────────────────────────────────────────────────────────
  removeDirector: protectedProcedure
    .input(z.object({ directorId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const app = await getApplicationForUser(db, ctx.user.id);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "No KYB application found" });
      assertApplicantEditable(app);
      const [{ count: current }] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(kybDirectors)
        .where(eq(kybDirectors.kybApplicationId, app.id));
      if (Number(current) <= 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "An application must retain at least one director." });
      }
      const [removed] = await db
        .delete(kybDirectors)
        .where(and(eq(kybDirectors.id, input.directorId), eq(kybDirectors.kybApplicationId, app.id)))
        .returning({ id: kybDirectors.id, fullName: kybDirectors.fullName });
      if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "Director not found on your application" });
      await writeKybAudit(db, {
        kybApplicationId: app.id, action: "DIRECTOR_REMOVED", performedBy: ctx.user.id,
        previousStatus: app.status, newStatus: app.status, notes: `Director '${removed.fullName}' removed.`,
      });
      return { success: true, removedId: removed.id };
    }),

  // ── addBeneficialOwner ──────────────────────────────────────────────────────
  addBeneficialOwner: protectedProcedure
    .input(beneficialOwnerInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const app = await getApplicationForUser(db, ctx.user.id);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "No KYB application found" });
      assertApplicantEditable(app);
      const existing = await db
        .select({ ownershipPercent: kybBeneficialOwners.ownershipPercent })
        .from(kybBeneficialOwners)
        .where(eq(kybBeneficialOwners.kybApplicationId, app.id));
      const newTotal = existing.reduce((s, o) => s + Number(o.ownershipPercent), 0) + input.ownershipPercent;
      if (newTotal > 100.0001) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Adding ${input.ownershipPercent}% would bring total ownership to ${newTotal.toFixed(2)}% (> 100%).`,
        });
      }
      const [owner] = await db.insert(kybBeneficialOwners).values({
        kybApplicationId: app.id,
        fullName: input.fullName,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
        nationality: input.nationality,
        bvnHash: input.bvn ? hashGovId(input.bvn) : null,
        ninHash: input.nin ? hashGovId(input.nin) : null,
        ownershipPercent: String(input.ownershipPercent),
        isUbo: input.ownershipPercent >= CBN_UBO_THRESHOLD,
        isPep: input.isPep,
        pepDetails: input.isPep ? (input.pepDetails ?? null) : null,
        idDocumentUrl: input.idDocumentUrl ?? null,
      }).returning();
      await writeKybAudit(db, {
        kybApplicationId: app.id, action: "UBO_ADDED", performedBy: ctx.user.id,
        previousStatus: app.status, newStatus: app.status,
        notes: `Beneficial owner '${input.fullName}' (${input.ownershipPercent}%) added${input.ownershipPercent >= CBN_UBO_THRESHOLD ? " — UBO threshold met" : ""}.`,
      });
      return owner;
    }),

  // ── removeBeneficialOwner ───────────────────────────────────────────────────
  removeBeneficialOwner: protectedProcedure
    .input(z.object({ ownerId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const app = await getApplicationForUser(db, ctx.user.id);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "No KYB application found" });
      assertApplicantEditable(app);
      const [removed] = await db
        .delete(kybBeneficialOwners)
        .where(and(eq(kybBeneficialOwners.id, input.ownerId), eq(kybBeneficialOwners.kybApplicationId, app.id)))
        .returning({ id: kybBeneficialOwners.id, fullName: kybBeneficialOwners.fullName });
      if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "Beneficial owner not found on your application" });
      await writeKybAudit(db, {
        kybApplicationId: app.id, action: "UBO_REMOVED", performedBy: ctx.user.id,
        previousStatus: app.status, newStatus: app.status, notes: `Beneficial owner '${removed.fullName}' removed.`,
      });
      return { success: true, removedId: removed.id };
    }),

  // ── getMyKybApplication ─────────────────────────────────────────────────────
  getMyKybApplication: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
    const app = await getApplicationForUser(db, ctx.user.id);
    if (!app) return null;
    const [directors, owners] = await Promise.all([
      db.select().from(kybDirectors).where(eq(kybDirectors.kybApplicationId, app.id)),
      db.select().from(kybBeneficialOwners).where(eq(kybBeneficialOwners.kybApplicationId, app.id)),
    ]);
    return { application: app, directors, beneficialOwners: owners };
  }),

  // ── getKybStatus (applicant-facing tracking, mirrors onboarding.getStatus) ──
  getKybStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { application: null, status: "NOT_STARTED" as const, timeline: [] };
    const app = await getApplicationForUser(db, ctx.user.id);
    if (!app) return { application: null, status: "NOT_STARTED" as const, timeline: [] };
    const [directorCount] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(kybDirectors)
      .where(eq(kybDirectors.kybApplicationId, app.id));
    const [ownerStats] = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
        uboCount: sql<number>`SUM(CASE WHEN is_ubo THEN 1 ELSE 0 END)::int`,
        totalOwnership: sql<string>`COALESCE(SUM(ownership_percent), 0)::text`,
      })
      .from(kybBeneficialOwners)
      .where(eq(kybBeneficialOwners.kybApplicationId, app.id));
    const timeline = await db
      .select()
      .from(kybAuditLog)
      .where(eq(kybAuditLog.kybApplicationId, app.id))
      .orderBy(desc(kybAuditLog.createdAt))
      .limit(50);
    return {
      application: app,
      status: app.status,
      riskLevel: app.riskLevel,
      screeningPending: app.status === "SCREENING" && !app.screeningCompletedAt,
      rejectionReason: app.rejectionReason,
      reviewNotes: app.reviewNotes,
      eddChecklist: app.eddChecklist ?? null,
      uploadedDocuments: Object.entries(app.documents ?? {})
        .filter(([, v]) => !!v)
        .map(([k]) => k),
      directorCount: Number(directorCount?.count ?? 0),
      beneficialOwnerCount: Number(ownerStats?.count ?? 0),
      declaredUboCount: Number(ownerStats?.uboCount ?? 0),
      totalOwnershipPercent: Number(ownerStats?.totalOwnership ?? 0),
      timeline,
    };
  }),

  // ── requestScreening (fail-closed against kyc-service KYB screening) ────────
  requestScreening: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const app = await getApplicationForUser(db, ctx.user.id);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "No KYB application found" });
      const isAdmin = ctx.user.role === "admin";
      if (!isAdmin && app.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your application" });
      }
      if (!["SUBMITTED", "SCREENING"].includes(app.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Screening can only be requested from SUBMITTED status (current: ${app.status}).` });
      }

      const directors = await db.select().from(kybDirectors).where(eq(kybDirectors.kybApplicationId, app.id));
      const owners = await db.select().from(kybBeneficialOwners).where(eq(kybBeneficialOwners.kybApplicationId, app.id));

      // Move to SCREENING first — fail-closed: if the service is unreachable the
      // application stays here and can never be approved without a completed screening.
      await db.update(kybApplications)
        .set({ status: "SCREENING", updatedAt: new Date() })
        .where(eq(kybApplications.id, app.id));
      await writeKybAudit(db, {
        kybApplicationId: app.id, action: "SCREENING_STARTED", performedBy: ctx.user.id,
        previousStatus: app.status, newStatus: "SCREENING",
      });

      const payload = {
        applicationId: String(app.id),
        businessName: app.businessName,
        businessType: app.businessType,
        registrationNumber: app.cacRcNumber,
        taxId: app.tinNumber,
        incorporationDate: app.incorporationDate ? app.incorporationDate.toISOString().slice(0, 10) : null,
        registeredAddress: app.registeredAddress,
        countryOfIncorporation: "Nigeria",
        industry: "commodity_trading",
        operatingStates: app.operatingStates ?? [],
        directors: directors.map((d) => ({
          fullName: d.fullName,
          role: d.role,
          nationality: "Nigerian",
          dateOfBirth: null,
        })),
        beneficialOwners: owners.map((o) => ({
          fullName: o.fullName,
          ownershipPercent: Number(o.ownershipPercent),
          nationality: o.nationality,
          dateOfBirth: o.dateOfBirth ? o.dateOfBirth.toISOString().slice(0, 10) : null,
          isPep: o.isPep,
        })),
      };

      let screening: Record<string, unknown>;
      try {
        const res = await fetch(`${KYC_SERVICE_URL}/api/v1/kyb/screen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(SCREENING_TIMEOUT_MS),
        });
        if (!res.ok) {
          throw new Error(`kyc-service screening error: HTTP ${res.status} ${await res.text()}`);
        }
        screening = (await res.json()) as Record<string, unknown>;
      } catch (err) {
        // FAIL-CLOSED: status remains SCREENING; admin UI shows "screening pending".
        console.error("[kybRouter] KYB screening service unreachable:", (err as Error).message);
        return {
          screeningCompleted: false,
          status: "SCREENING" as const,
          screeningPending: true,
          error: "Screening service unavailable — application remains in SCREENING and cannot be approved until screening completes.",
        };
      }

      const riskLevel = mapServiceRiskLevel(screening.riskLevel as string | undefined);
      const mergedResult = {
        ...((app.screeningResult ?? {}) as Record<string, unknown>),
        screening,
      };
      await db.update(kybApplications)
        .set({
          status: "UNDER_REVIEW",
          riskLevel,
          screeningResult: mergedResult,
          screeningCompletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(kybApplications.id, app.id));
      await writeKybAudit(db, {
        kybApplicationId: app.id, action: "SCREENING_COMPLETED", performedBy: ctx.user.id,
        previousStatus: "SCREENING", newStatus: "UNDER_REVIEW",
        notes: `Risk level: ${riskLevel}; recommendation: ${(screening.recommendation as string) ?? "n/a"}.`,
      });
      notifyOwner({
        title: `[KYB] Screening completed — ${app.businessName}`,
        content: `KYB application #${app.id} screening finished. Risk: ${riskLevel}, recommendation: ${(screening.recommendation as string) ?? "n/a"}. Review at /admin/kyb-review.`,
      }).catch((e) => console.warn("[kybRouter] notifyOwner failed:", (e as Error).message));

      return {
        screeningCompleted: true,
        status: "UNDER_REVIEW" as const,
        screeningPending: false,
        riskLevel,
        recommendation: (screening.recommendation as string) ?? null,
        screening,
      };
    }),

  // ── adminListKybApplications ────────────────────────────────────────────────
  adminListKybApplications: adminProcedure
    .input(z.object({
      status: z.enum(["DRAFT", "SUBMITTED", "SCREENING", "UNDER_REVIEW", "EDD_REQUIRED", "APPROVED", "REJECTED", "SUSPENDED"]).optional(),
      riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "PROHIBITED"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const conditions = [
        ...(input.status ? [eq(kybApplications.status, input.status)] : []),
        ...(input.riskLevel ? [eq(kybApplications.riskLevel, input.riskLevel)] : []),
      ];
      const where = conditions.length ? and(...conditions) : undefined;
      const [rows, countResult, stats] = await Promise.all([
        db
          .select({
            id: kybApplications.id,
            userId: kybApplications.userId,
            businessName: kybApplications.businessName,
            businessType: kybApplications.businessType,
            cacRcNumber: kybApplications.cacRcNumber,
            status: kybApplications.status,
            riskLevel: kybApplications.riskLevel,
            screeningCompletedAt: kybApplications.screeningCompletedAt,
            createdAt: kybApplications.createdAt,
            userName: users.name,
            userEmail: users.email,
          })
          .from(kybApplications)
          .leftJoin(users, eq(kybApplications.userId, users.id))
          .where(where)
          .orderBy(desc(kybApplications.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ total: sql<number>`COUNT(*)::int` }).from(kybApplications).where(where),
        db.select({
          submitted: sql<number>`SUM(CASE WHEN status = 'SUBMITTED' THEN 1 ELSE 0 END)::int`,
          screening: sql<number>`SUM(CASE WHEN status = 'SCREENING' THEN 1 ELSE 0 END)::int`,
          underReview: sql<number>`SUM(CASE WHEN status = 'UNDER_REVIEW' THEN 1 ELSE 0 END)::int`,
          eddRequired: sql<number>`SUM(CASE WHEN status = 'EDD_REQUIRED' THEN 1 ELSE 0 END)::int`,
          approved: sql<number>`SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END)::int`,
          rejected: sql<number>`SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END)::int`,
          suspended: sql<number>`SUM(CASE WHEN status = 'SUSPENDED' THEN 1 ELSE 0 END)::int`,
          highRisk: sql<number>`SUM(CASE WHEN risk_level IN ('HIGH','PROHIBITED') THEN 1 ELSE 0 END)::int`,
        }).from(kybApplications),
      ]);
      return { applications: rows, total: Number(countResult[0]?.total ?? 0), stats: stats[0] };
    }),

  // ── adminGetKybApplication (full detail) ────────────────────────────────────
  adminGetKybApplication: adminProcedure
    .input(z.object({ applicationId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [app] = await db
        .select()
        .from(kybApplications)
        .where(eq(kybApplications.id, input.applicationId))
        .limit(1);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "KYB application not found" });
      const [directors, owners, auditTrail, applicant] = await Promise.all([
        db.select().from(kybDirectors).where(eq(kybDirectors.kybApplicationId, app.id)),
        db.select().from(kybBeneficialOwners).where(eq(kybBeneficialOwners.kybApplicationId, app.id)),
        db.select().from(kybAuditLog).where(eq(kybAuditLog.kybApplicationId, app.id)).orderBy(desc(kybAuditLog.createdAt)),
        db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, app.userId)).limit(1),
      ]);
      return {
        application: app,
        directors,
        beneficialOwners: owners,
        auditTrail,
        applicant: applicant[0] ?? null,
        screeningPending: app.status === "SCREENING" && !app.screeningCompletedAt,
      };
    }),

  // ── adminReviewKyb ──────────────────────────────────────────────────────────
  adminReviewKyb: adminProcedure
    .input(z.object({
      applicationId: z.number().int().positive(),
      decision: z.enum(["APPROVED", "REJECTED", "EDD_REQUIRED"]),
      notes: z.string().max(4000).optional(),
      rejectionReason: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [app] = await db
        .select()
        .from(kybApplications)
        .where(eq(kybApplications.id, input.applicationId))
        .limit(1);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "KYB application not found" });

      if (input.decision === "EDD_REQUIRED") {
        if (!(["UNDER_REVIEW", "SCREENING", "EDD_REQUIRED", "SUBMITTED"] as string[]).includes(app.status)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot escalate a ${app.status} application to EDD.` });
        }
      } else {
        if (!(REVIEWABLE_STATUSES as readonly string[]).includes(app.status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              app.status === "SCREENING"
                ? "Screening has not completed — fail-closed policy: this application cannot be decided until screening completes."
                : `Application status ${app.status} is not reviewable.`,
          });
        }
        // Fail-closed: never approve without a completed screening result.
        if (input.decision === "APPROVED" && !app.screeningCompletedAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot approve: screening has not been completed for this application.",
          });
        }
        if (input.decision === "REJECTED" && !input.rejectionReason && !input.notes) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A rejection reason is required." });
        }
      }

      const previousStatus = app.status;
      const now = new Date();

      await db.transaction(async (tx) => {
        await tx.update(kybApplications)
          .set({
            status: input.decision,
            reviewedBy: ctx.user.id,
            reviewedAt: now,
            reviewNotes: input.notes ?? null,
            rejectionReason: input.decision === "REJECTED" ? (input.rejectionReason ?? input.notes ?? "Rejected") : null,
            updatedAt: now,
          })
          .where(eq(kybApplications.id, app.id));

        await tx.insert(kybAuditLog).values({
          kybApplicationId: app.id,
          action: `REVIEW_${input.decision}`,
          performedBy: ctx.user.id,
          previousStatus,
          newStatus: input.decision,
          notes: input.notes ?? input.rejectionReason ?? null,
        });

        if (input.decision === "APPROVED") {
          // KYB approval unlocks the corporate trading tier (Tier 3: no daily
          // limit, requires full CAC verification — server/business-rules.ts).
          await tx.insert(userKycTiers)
            .values({
              userId: app.userId,
              tier: "TIER_3",
              reason: `KYB application #${app.id} approved (full CAC verification)`,
              updatedBy: ctx.user.id,
            })
            .onConflictDoUpdate({
              target: userKycTiers.userId,
              set: {
                tier: "TIER_3",
                reason: `KYB application #${app.id} approved (full CAC verification)`,
                updatedBy: ctx.user.id,
                updatedAt: now,
              },
            });
          // Unlock the linked stakeholder profile(s) so the corporate tier is
          // honoured by the existing per-stakeholder KYC gates.
          await tx.update(brokerProfiles)
            .set({ kycStatus: "APPROVED", accountStatus: "ACTIVE", updatedAt: now })
            .where(and(eq(brokerProfiles.userId, app.userId), eq(brokerProfiles.kycStatus, "UNDER_REVIEW")));
          await tx.update(traderProfiles)
            .set({ kycStatus: "APPROVED", accountStatus: "ACTIVE", updatedAt: now })
            .where(and(eq(traderProfiles.userId, app.userId), eq(traderProfiles.kycStatus, "UNDER_REVIEW")));
        }

        await tx.insert(notifications).values({
          userId: app.userId,
          title:
            input.decision === "APPROVED" ? "KYB Verification Approved" :
            input.decision === "REJECTED" ? "KYB Verification Rejected" :
            "Enhanced Due Diligence Required",
          message:
            input.decision === "APPROVED"
              ? `Your business verification for "${app.businessName}" has been approved. Your account now has corporate (Tier 3) trading access.`
              : input.decision === "REJECTED"
                ? `Your business verification for "${app.businessName}" was rejected. Reason: ${input.rejectionReason ?? input.notes ?? "See review notes"}.`
                : `Your business verification for "${app.businessName}" requires enhanced due diligence. Our compliance team will contact you with the additional requirements.`,
          type: "KYC",
          metadata: { kybApplicationId: app.id, decision: input.decision },
        });
      });

      writeAuditLog({
        userId: ctx.user.id,
        action: `KYB_REVIEW_${input.decision}`,
        resource: "kyb_applications",
        resourceId: String(app.id),
        details: {
          decision: input.decision,
          previousStatus,
          targetUserId: app.userId,
          notes: input.notes ?? input.rejectionReason ?? null,
        },
      });
      notifyOwner({
        title: `[KYB] Application ${input.decision} — ${app.businessName}`,
        content:
          `KYB application #${app.id} ("${app.businessName}", user ${app.userId}) was ${input.decision} by ${ctx.user.name ?? "admin"}.` +
          (input.notes ? ` Notes: ${input.notes}` : "") +
          (input.rejectionReason ? ` Reason: ${input.rejectionReason}` : ""),
      }).catch((e) => console.warn("[kybRouter] notifyOwner failed:", (e as Error).message));

      return { applicationId: app.id, status: input.decision, previousStatus };
    }),

  // ── escalateToEdd ───────────────────────────────────────────────────────────
  escalateToEdd: adminProcedure
    .input(z.object({
      applicationId: z.number().int().positive(),
      checklist: z.array(z.object({
        item: z.string().min(2).max(500),
        done: z.boolean().default(false),
        note: z.string().max(1000).optional(),
      })).optional(),
      notes: z.string().max(4000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [app] = await db
        .select()
        .from(kybApplications)
        .where(eq(kybApplications.id, input.applicationId))
        .limit(1);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "KYB application not found" });
      if (["APPROVED", "REJECTED", "SUSPENDED"].includes(app.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot escalate a ${app.status} application.` });
      }
      const checklist = input.checklist ?? [
        { item: "Verify source of funds / wealth for all declared UBOs", done: false },
        { item: "Obtain certified CAC status report (not older than 3 months)", done: false },
        { item: "In-person or video verification of at least one director", done: false },
        { item: "Adverse media deep-search on entity, directors and UBOs", done: false },
        { item: "Confirm operating address via utility bill or site visit", done: false },
      ];
      await db.update(kybApplications)
        .set({ status: "EDD_REQUIRED", eddChecklist: checklist, updatedAt: new Date() })
        .where(eq(kybApplications.id, app.id));
      await writeKybAudit(db, {
        kybApplicationId: app.id, action: "ESCALATED_TO_EDD", performedBy: ctx.user.id,
        previousStatus: app.status, newStatus: "EDD_REQUIRED",
        notes: input.notes ?? `${checklist.length} EDD checklist items assigned.`,
      });
      await notifyApplicant(
        app.userId,
        "Enhanced Due Diligence Required",
        `Your business verification for "${app.businessName}" requires enhanced due diligence. Our compliance team will contact you with the additional requirements.`,
      );
      writeAuditLog({
        userId: ctx.user.id,
        action: "KYB_ESCALATE_EDD",
        resource: "kyb_applications",
        resourceId: String(app.id),
        details: { previousStatus: app.status, checklistItems: checklist.length },
      });
      return { applicationId: app.id, status: "EDD_REQUIRED" as const, checklist };
    }),

  // ── adminSuspendKyb (post-approval suspension, e.g. new adverse media hit) ──
  adminSuspendKyb: adminProcedure
    .input(z.object({
      applicationId: z.number().int().positive(),
      reason: z.string().min(5).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [app] = await db
        .select()
        .from(kybApplications)
        .where(eq(kybApplications.id, input.applicationId))
        .limit(1);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "KYB application not found" });
      if (app.status !== "APPROVED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only APPROVED applications can be suspended." });
      }
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx.update(kybApplications)
          .set({ status: "SUSPENDED", updatedAt: now })
          .where(eq(kybApplications.id, app.id));
        await tx.insert(kybAuditLog).values({
          kybApplicationId: app.id,
          action: "SUSPENDED",
          performedBy: ctx.user.id,
          previousStatus: "APPROVED",
          newStatus: "SUSPENDED",
          notes: input.reason,
        });
        // Revoke the corporate trading tier while suspended
        await tx.update(userKycTiers)
          .set({ tier: "TIER_1", reason: `KYB suspended: ${input.reason}`, updatedBy: ctx.user.id, updatedAt: now })
          .where(eq(userKycTiers.userId, app.userId));
        await tx.update(brokerProfiles)
          .set({ accountStatus: "SUSPENDED", updatedAt: now })
          .where(eq(brokerProfiles.userId, app.userId));
        await tx.update(traderProfiles)
          .set({ accountStatus: "SUSPENDED", updatedAt: now })
          .where(eq(traderProfiles.userId, app.userId));
        await tx.insert(notifications).values({
          userId: app.userId,
          title: "KYB Verification Suspended",
          message:
            `Your business verification for "${app.businessName}" has been suspended pending further review. ` +
            `Reason: ${input.reason}. Corporate trading access has been revoked while suspended.`,
          type: "KYC",
          metadata: { kybApplicationId: app.id, decision: "SUSPENDED" },
        });
      });
      writeAuditLog({
        userId: ctx.user.id,
        action: "KYB_SUSPENDED",
        resource: "kyb_applications",
        resourceId: String(app.id),
        details: { reason: input.reason, targetUserId: app.userId },
      });
      notifyOwner({
        title: `[KYB] Application suspended — ${app.businessName}`,
        content: `KYB application #${app.id} ("${app.businessName}") suspended by ${ctx.user.name ?? "admin"}. Reason: ${input.reason}`,
      }).catch((e) => console.warn("[kybRouter] notifyOwner failed:", (e as Error).message));
      return { applicationId: app.id, status: "SUSPENDED" as const };
    }),
});
