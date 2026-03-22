/**
 * NEXCOM Exchange — Cooperative Member CSV Export
 *
 * GET /api/cooperative/export-members
 * Admin-only endpoint that streams a CSV of all KYC members associated
 * with the authenticated admin's cooperative bulk uploads.
 *
 * Query params:
 *   status  — filter by KYC status (PENDING | UNDER_REVIEW | APPROVED | REJECTED | ALL)
 *   uploadId — filter by a specific bulk upload ID
 *
 * Authentication: reads the session cookie (same JWT as tRPC procedures).
 */
import { Router, Request, Response } from "express";
import { getDb } from "../db";
import { kycQueue, cooperativeBulkUploads, users } from "../../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { sdk } from "../_core/sdk";

export function registerCooperativeExportRoute(app: Router): void {
  app.get("/api/cooperative/export-members", async (req: Request, res: Response) => {
    // ── Authentication ────────────────────────────────────────────────────────
    let userId: number;
    let userRole: string;
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      userId = user.id;
      userRole = user.role ?? "user";
    } catch {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (userRole !== "admin") {
      res.status(403).json({ error: "Forbidden: admin access required" });
      return;
    }

    // ── Query params ──────────────────────────────────────────────────────────
    const statusFilter = (req.query.status as string | undefined) ?? "ALL";
    const uploadIdParam = req.query.uploadId ? parseInt(req.query.uploadId as string, 10) : null;

    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }

    // ── Find all bulk uploads by this admin ───────────────────────────────────
    let uploadRows = await db
      .select()
      .from(cooperativeBulkUploads)
      .where(
        uploadIdParam
          ? and(
              eq(cooperativeBulkUploads.uploadedBy, userId),
              eq(cooperativeBulkUploads.id, uploadIdParam),
            )
          : eq(cooperativeBulkUploads.uploadedBy, userId),
      );

    if (uploadRows.length === 0) {
      // Return empty CSV
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=\"members.csv\"");
      res.send("id,name,bvn,phone,email,kyc_status,upload_id,upload_file,submitted_at,reviewed_at\r\n");
      return;
    }

    // Collect all member IDs from createdApplicationIds across uploads
    const allMemberIds: number[] = [];
    for (const u of uploadRows) {
      const ids = (u.createdApplicationIds as number[] | null) ?? [];
      allMemberIds.push(...ids);
    }

    // Build a map from member id → upload info
    const memberUploadMap = new Map<number, { uploadId: number; fileName: string }>();
    for (const u of uploadRows) {
      const ids = (u.createdApplicationIds as number[] | null) ?? [];
      for (const mid of ids) {
        memberUploadMap.set(mid, { uploadId: u.id, fileName: u.fileName });
      }
    }

    if (allMemberIds.length === 0) {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=\"members.csv\"");
      res.send("id,name,bvn,phone,email,kyc_status,upload_id,upload_file,submitted_at,reviewed_at\r\n");
      return;
    }

    // ── Fetch KYC records ─────────────────────────────────────────────────────
    let memberQuery = db
      .select({
        kycId: kycQueue.id,
        userId: kycQueue.userId,
        status: kycQueue.status,
        documents: kycQueue.documents,
        submittedAt: kycQueue.submittedAt,
        reviewedAt: kycQueue.reviewedAt,
        reviewNotes: kycQueue.reviewNotes,
        userName: users.name,
        userEmail: users.email,
      })
      .from(kycQueue)
      .leftJoin(users, eq(users.id, kycQueue.userId))
      .where(inArray(kycQueue.id, allMemberIds));

    const members = await memberQuery;

    // Apply status filter
    const filtered = statusFilter === "ALL"
      ? members
      : members.filter(m => m.status === statusFilter);

    // ── Build CSV ─────────────────────────────────────────────────────────────
    const escape = (val: string | null | undefined): string => {
      if (val == null) return "";
      const str = String(val);
      if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
        return `"${str.replace(/"/g, "\"\"")}"`;
      }
      return str;
    };

    const header = "id,name,email,kyc_status,upload_id,upload_file,submitted_at,reviewed_at,review_notes\r\n";
    const rows = filtered.map(m => {
      const uploadInfo = memberUploadMap.get(m.kycId) ?? { uploadId: "", fileName: "" };
      const docs = (m.documents as Record<string, string> | null) ?? {};
      return [
        escape(String(m.kycId)),
        escape(m.userName ?? docs.fullName ?? ""),
        escape(m.userEmail ?? docs.email ?? ""),
        escape(m.status),
        escape(String(uploadInfo.uploadId)),
        escape(uploadInfo.fileName),
        escape(m.submittedAt ? new Date(m.submittedAt).toISOString() : ""),
        escape(m.reviewedAt ? new Date(m.reviewedAt).toISOString() : ""),
        escape(m.reviewNotes ?? ""),
      ].join(",");
    });

    const csv = header + rows.join("\r\n");
    const filename = `nexcom-members-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(csv);
  });
}
