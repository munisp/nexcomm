/**
 * NEXCOM Exchange — Dispute Evidence File Upload
 *
 * POST /api/disputes/:disputeId/evidence
 * Authenticated endpoint that accepts a multipart file upload,
 * stores it in S3, and returns the file metadata for the client
 * to then call trpc.disputes.addEvidence with.
 *
 * File constraints:
 *   - Max size: 10 MB
 *   - Allowed MIME types: PDF, JPEG, PNG, WEBP, DOCX
 *
 * Authentication: reads the session cookie (same JWT as tRPC procedures).
 */
import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import multer, { FileFilterCallback } from "multer";
import type { Request as ExpressRequest } from "express";
import { sdk } from "../_core/sdk";
import { storagePut } from "../storage";
import { validateFileUpload } from "../security-middleware";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

// Use memory storage so we can pipe directly to S3
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req: ExpressRequest, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed. Accepted: PDF, JPEG, PNG, WEBP, DOCX`));
    }
  },
});

function randomSuffix(): string {
  return randomUUID().replace(/-/g, '').substring(0, 8);
}

export function registerDisputeEvidenceUploadRoute(app: Router): void {
  app.post(
    "/api/disputes/:disputeId/evidence",
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

      const disputeId = parseInt(req.params.disputeId, 10);
      if (!disputeId || isNaN(disputeId)) {
        res.status(400).json({ error: "Invalid disputeId" });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: "No file provided" });
        return;
      }

      const { originalname, mimetype, buffer, size } = req.file;

      // ── Ransomware / malware file validation ──────────────────────────────────
      const fileValidation = validateFileUpload(originalname, buffer, mimetype);
      if (!fileValidation.valid) {
        console.warn(`[DisputeEvidence] Blocked suspicious file from user ${userId}: ${fileValidation.reason}`);
        res.status(400).json({ error: `File rejected: ${fileValidation.reason}` });
        return;
      }
      // Sanitize filename
      const safeName = originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileKey = `dispute-evidence/${userId}/${disputeId}/${safeName}-${randomSuffix()}`;

      try {
        const { url } = await storagePut(fileKey, buffer, mimetype);

        res.json({
          fileKey,
          fileUrl: url,
          fileName: originalname,
          mimeType: mimetype,
          fileSize: size,
        });
      } catch (err) {
        console.error("[DisputeEvidenceUpload] S3 upload failed:", err);
        res.status(500).json({ error: "File upload failed. Please try again." });
      }
    },
  );
}
