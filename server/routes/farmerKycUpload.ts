/**
 * NEXCOM Exchange — Farmer KYC Document Upload
 *
 * POST /api/farmer/kyc-upload
 * Authenticated endpoint that accepts a multipart file upload (NIN slip,
 * BVN confirmation, passport photo, utility bill, etc.), stores it in S3,
 * and returns the CDN URL for the client to include in trpc.farmer.submitKYC.
 *
 * File constraints:
 *   - Max size: 10 MB
 *   - Allowed MIME types: PDF, JPEG, PNG, WEBP
 */
import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import multer, { FileFilterCallback } from "multer";
import type { Request as ExpressRequest } from "express";
import { sdk } from "../_core/sdk";
import { storagePut } from "../storage";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  nin_slip: "NIN Slip",
  bvn_confirmation: "BVN Confirmation",
  passport_photo: "Passport Photo",
  utility_bill: "Utility Bill",
  land_title: "Land Title",
  farm_photo: "Farm Photo",
  other: "Other",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req: ExpressRequest, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed. Accepted: PDF, JPEG, PNG, WEBP`));
    }
  },
});

function randomSuffix(): string {
  return randomUUID().replace(/-/g, "").substring(0, 8);
}

export function registerFarmerKycUploadRoute(app: Router): void {
  app.post(
    "/api/farmer/kyc-upload",
    upload.single("file"),
    async (req: Request, res: Response) => {
      // ── Authentication ──────────────────────────────────────────────────────
      let userId: number;
      try {
        const user = await sdk.authenticateRequest(req);
        if (!user) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
        userId = user.id;
      } catch {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: "No file provided" });
        return;
      }

      // documentType: nin_slip | bvn_confirmation | passport_photo | utility_bill | land_title | farm_photo | other
      const documentType = (req.body?.documentType as string) || "other";
      const label = DOCUMENT_TYPE_LABELS[documentType] ?? "Document";

      const { originalname, mimetype, buffer, size } = req.file;
      const safeName = originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileKey = `farmer-kyc/${userId}/${documentType}/${safeName}-${randomSuffix()}`;

      try {
        const { url } = await storagePut(fileKey, buffer, mimetype);
        res.json({
          fileKey,
          fileUrl: url,
          fileName: originalname,
          documentType,
          documentLabel: label,
          mimeType: mimetype,
          fileSize: size,
        });
      } catch (err) {
        console.error("[FarmerKycUpload] S3 upload failed:", err);
        res.status(500).json({ error: "File upload failed. Please try again." });
      }
    },
  );
}
