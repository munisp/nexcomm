/**
 * NEXCOM Exchange — KYB (Know Your Business) Workflow Schema
 * ─────────────────────────────────────────────────────────────────────────────
 * Corporate onboarding tables: KYB applications, beneficial owners (UBOs),
 * directors, and a KYB-specific audit trail.
 *
 * NOTE (FIX-KYB): This file is intentionally separate from drizzle/schema.ts
 * to avoid merge conflicts with parallel work. To activate, add the following
 * line to drizzle/schema.ts:
 *
 *     export * from "./schema-kyb";
 *
 * Migration: drizzle/0070_kyb_workflows.sql
 */
import {
  pgTable,
  pgEnum,
  bigserial,
  integer,
  varchar,
  text,
  boolean,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./schema";

// ============================================================
// Enums
// ============================================================

export const kybBusinessTypeEnum = pgEnum("kyb_business_type", [
  "SOLE_PROP",
  "LLC",
  "PLC",
  "COOPERATIVE",
  "PARTNERSHIP",
  "NGO",
]);

export const kybApplicationStatusEnum = pgEnum("kyb_application_status", [
  "DRAFT",
  "SUBMITTED",
  "SCREENING",
  "UNDER_REVIEW",
  "EDD_REQUIRED",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
]);

export const kybRiskLevelEnum = pgEnum("kyb_risk_level", [
  "LOW",
  "MEDIUM",
  "HIGH",
  "PROHIBITED",
]);

export const kybVerificationStatusEnum = pgEnum("kyb_verification_status", [
  "PENDING",
  "VERIFIED",
  "FAILED",
  "MANUAL_REVIEW",
]);

// ============================================================
// KYB Documents (jsonb payload shape on kybApplications.documents)
// ============================================================

export interface KybDocuments {
  cacCertificateUrl?: string;
  memartUrl?: string;
  statusReportUrl?: string;
  boardResolutionUrl?: string;
  proofOfAddressUrl?: string;
}

export const KYB_DOCUMENT_SLOTS = [
  "cacCertificate",
  "memart",
  "statusReport",
  "boardResolution",
  "proofOfAddress",
] as const;
export type KybDocumentSlot = (typeof KYB_DOCUMENT_SLOTS)[number];

/** Maps a document slot name to its key inside the documents jsonb column. */
export const KYB_DOC_SLOT_TO_FIELD: Record<KybDocumentSlot, keyof KybDocuments> = {
  cacCertificate: "cacCertificateUrl",
  memart: "memartUrl",
  statusReport: "statusReportUrl",
  boardResolution: "boardResolutionUrl",
  proofOfAddress: "proofOfAddressUrl",
};

// ============================================================
// KYB Applications
// ============================================================

export const kybApplications = pgTable(
  "kyb_applications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    businessName: varchar("business_name", { length: 256 }).notNull(),
    businessType: kybBusinessTypeEnum("business_type").notNull(),
    cacRcNumber: varchar("cac_rc_number", { length: 32 }),
    tinNumber: varchar("tin_number", { length: 20 }),
    incorporationDate: timestamp("incorporation_date"),
    registeredAddress: text("registered_address"),
    operatingStates: jsonb("operating_states").$type<string[]>(),
    websiteUrl: varchar("website_url", { length: 256 }),
    contactEmail: varchar("contact_email", { length: 200 }),
    contactPhone: varchar("contact_phone", { length: 30 }),
    expectedMonthlyVolume: numeric("expected_monthly_volume", { precision: 20, scale: 2 }),
    /** Typed document slots — see KybDocuments / KYB_DOCUMENT_SLOTS */
    documents: jsonb("documents").$type<KybDocuments>().default({}).notNull(),
    status: kybApplicationStatusEnum("status").default("DRAFT").notNull(),
    riskLevel: kybRiskLevelEnum("risk_level"),
    /** Structured result from the kyc-service KYB screening engine */
    screeningResult: jsonb("screening_result"),
    screeningCompletedAt: timestamp("screening_completed_at"),
    /** EDD checklist populated by escalateToEdd */
    eddChecklist: jsonb("edd_checklist").$type<{ item: string; done: boolean; note?: string }[]>(),
    reviewedBy: integer("reviewed_by"),
    reviewedAt: timestamp("reviewed_at"),
    reviewNotes: text("review_notes"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("idx_kyb_applications_user").on(t.userId),
    statusIdx: index("idx_kyb_applications_status").on(t.status),
    riskIdx: index("idx_kyb_applications_risk").on(t.riskLevel),
    rcIdx: index("idx_kyb_applications_rc").on(t.cacRcNumber),
  }),
);
export type KybApplication = typeof kybApplications.$inferSelect;
export type InsertKybApplication = typeof kybApplications.$inferInsert;

// ============================================================
// KYB Beneficial Owners (UBOs)
// ============================================================

export const kybBeneficialOwners = pgTable(
  "kyb_beneficial_owners",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kybApplicationId: integer("kyb_application_id")
      .notNull()
      .references(() => kybApplications.id, { onDelete: "cascade" }),
    fullName: varchar("full_name", { length: 200 }).notNull(),
    dateOfBirth: timestamp("date_of_birth"),
    nationality: varchar("nationality", { length: 100 }).default("Nigerian").notNull(),
    /** SHA-256 hash of BVN — raw BVN is never stored */
    bvnHash: varchar("bvn_hash", { length: 64 }),
    /** SHA-256 hash of NIN — raw NIN is never stored */
    ninHash: varchar("nin_hash", { length: 64 }),
    ownershipPercent: numeric("ownership_percent", { precision: 5, scale: 2 }).notNull(),
    /** True when ownershipPercent >= 25 (CBN UBO threshold) */
    isUbo: boolean("is_ubo").default(false).notNull(),
    isPep: boolean("is_pep").default(false).notNull(),
    pepDetails: text("pep_details"),
    idDocumentUrl: text("id_document_url"),
    verificationStatus: kybVerificationStatusEnum("verification_status").default("PENDING").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    appIdx: index("idx_kyb_ubos_application").on(t.kybApplicationId),
  }),
);
export type KybBeneficialOwner = typeof kybBeneficialOwners.$inferSelect;
export type InsertKybBeneficialOwner = typeof kybBeneficialOwners.$inferInsert;

// ============================================================
// KYB Directors
// ============================================================

export const kybDirectors = pgTable(
  "kyb_directors",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kybApplicationId: integer("kyb_application_id")
      .notNull()
      .references(() => kybApplications.id, { onDelete: "cascade" }),
    fullName: varchar("full_name", { length: 200 }).notNull(),
    role: varchar("role", { length: 100 }).default("Director").notNull(),
    appointmentDate: timestamp("appointment_date"),
    /** SHA-256 hash of BVN — raw BVN is never stored */
    bvnHash: varchar("bvn_hash", { length: 64 }),
    /** SHA-256 hash of NIN — raw NIN is never stored */
    ninHash: varchar("nin_hash", { length: 64 }),
    /** Set when the director is also a registered platform user */
    linkedUserId: integer("linked_user_id").references(() => users.id, { onDelete: "set null" }),
    idDocumentUrl: text("id_document_url"),
    verificationStatus: kybVerificationStatusEnum("verification_status").default("PENDING").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    appIdx: index("idx_kyb_directors_application").on(t.kybApplicationId),
  }),
);
export type KybDirector = typeof kybDirectors.$inferSelect;
export type InsertKybDirector = typeof kybDirectors.$inferInsert;

// ============================================================
// KYB Audit Log (KYB-specific lifecycle trail; distinct from kyc_audit_log)
// ============================================================

export const kybAuditLog = pgTable(
  "kyb_audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kybApplicationId: integer("kyb_application_id")
      .notNull()
      .references(() => kybApplications.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 64 }).notNull(),
    performedBy: integer("performed_by"),
    previousStatus: varchar("previous_status", { length: 32 }),
    newStatus: varchar("new_status", { length: 32 }),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    appIdx: index("idx_kyb_audit_log_application").on(t.kybApplicationId),
  }),
);
export type KybAuditLog = typeof kybAuditLog.$inferSelect;
export type InsertKybAuditLog = typeof kybAuditLog.$inferInsert;

// ============================================================
// KYC Tier Upgrade Requests (KYC lifecycle — Tier 1 → 2 → 3)
// ============================================================

export const kycTierEnum = pgEnum("kyc_tier", ["TIER_1", "TIER_2", "TIER_3"]);

export const kycTierUpgradeStatusEnum = pgEnum("kyc_tier_upgrade_status", [
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
]);

export const kycTierUpgradeRequests = pgTable(
  "kyc_tier_upgrade_requests",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fromTier: kycTierEnum("from_tier").notNull(),
    toTier: kycTierEnum("to_tier").notNull(),
    /** Documents supplied to satisfy the target tier requirements */
    documents: jsonb("documents").$type<Record<string, string>>().default({}).notNull(),
    /** For TIER_3: linked approved KYB application */
    kybApplicationId: integer("kyb_application_id").references(() => kybApplications.id, {
      onDelete: "set null",
    }),
    status: kycTierUpgradeStatusEnum("status").default("PENDING").notNull(),
    reviewedBy: integer("reviewed_by"),
    reviewedAt: timestamp("reviewed_at"),
    reviewNotes: text("review_notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("idx_kyc_tier_upgrades_user").on(t.userId),
    statusIdx: index("idx_kyc_tier_upgrades_status").on(t.status),
    userTierUnique: uniqueIndex("uq_kyc_tier_upgrades_user_target").on(t.userId, t.toTier),
  }),
);
export type KycTierUpgradeRequest = typeof kycTierUpgradeRequests.$inferSelect;
export type InsertKycTierUpgradeRequest = typeof kycTierUpgradeRequests.$inferInsert;

// ============================================================
// Per-user current KYC tier (written by kycLifecycleRouter)
// ============================================================

export const userKycTiers = pgTable(
  "user_kyc_tiers",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .unique(),
    tier: kycTierEnum("tier").default("TIER_1").notNull(),
    /** Reason for last change (upgrade approval, re-KYC downgrade, KYB approval) */
    reason: text("reason"),
    updatedBy: integer("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    tierIdx: index("idx_user_kyc_tiers_tier").on(t.tier),
  }),
);
export type UserKycTier = typeof userKycTiers.$inferSelect;
export type InsertUserKycTier = typeof userKycTiers.$inferInsert;
