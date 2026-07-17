/**
 * fileManagerRouter — per-user file storage backed by MinIO / S3.
 *
 * Procedures:
 *   requestUpload   — generate a presigned PUT URL the client uploads to directly
 *   confirmUpload   — after the client finishes the PUT, record the file in the DB
 *   list            — list the current user's files (optionally filtered by folder)
 *   getDownloadUrl  — generate a presigned GET URL for a file
 *   delete          — delete a file from S3 and remove its DB record
 *   listFolders     — distinct folder names for the current user
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { userFiles } from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  storagePut,
  storageGet,
  storageDelete,
  getPresignedUploadUrl,
} from "../storage";
import crypto from "crypto";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export const fileManagerRouter = router({
  // ─── Request a presigned PUT URL ─────────────────────────────────────────
  requestUpload: protectedProcedure
    .input(
      z.object({
        fileName: z.string().min(1).max(512),
        mimeType: z.string().min(1).max(128),
        sizeBytes: z.number().int().min(1).max(MAX_FILE_SIZE),
        folder: z.string().max(128).default("general"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const suffix = crypto.randomBytes(8).toString("hex");
      const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileKey = `user-files/${ctx.user.id}/${input.folder}/${Date.now()}-${suffix}-${safeFileName}`;
      const uploadUrl = await getPresignedUploadUrl(fileKey, input.mimeType, 900);
      return { uploadUrl, fileKey };
    }),

  // ─── Confirm upload: record in DB after client PUT succeeds ──────────────
  confirmUpload: protectedProcedure
    .input(
      z.object({
        fileKey: z.string().min(1).max(1024),
        fileName: z.string().min(1).max(512),
        mimeType: z.string().min(1).max(128),
        sizeBytes: z.number().int().min(1).max(MAX_FILE_SIZE),
        folder: z.string().max(128).default("general"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.fileKey.startsWith(`user-files/${ctx.user.id}/`)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "File key does not belong to this user" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const { url: fileUrl } = await storageGet(input.fileKey);

      const [record] = await db
        .insert(userFiles)
        .values({
          userId: ctx.user.id,
          fileName: input.fileName,
          fileKey: input.fileKey,
          fileUrl,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          folder: input.folder,
        })
        .returning();

      return record;
    }),

  // ─── List files ──────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        folder: z.string().max(128).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0, page: input.page, pageSize: input.pageSize };

      const conditions = [eq(userFiles.userId, ctx.user.id)];
      if (input.folder) conditions.push(eq(userFiles.folder, input.folder));

      const where = and(...conditions);
      const offset = (input.page - 1) * input.pageSize;

      const [items, totalResult] = await Promise.all([
        db
          .select()
          .from(userFiles)
          .where(where)
          .orderBy(desc(userFiles.uploadedAt))
          .limit(input.pageSize)
          .offset(offset),
        db.select({ cnt: sql<number>`count(*)::int` }).from(userFiles).where(where),
      ]);

      return {
        items,
        total: totalResult[0]?.cnt ?? 0,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // ─── Get a presigned download URL ────────────────────────────────────────
  getDownloadUrl: protectedProcedure
    .input(z.object({ fileId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [file] = await db
        .select()
        .from(userFiles)
        .where(and(eq(userFiles.id, input.fileId), eq(userFiles.userId, ctx.user.id)))
        .limit(1);

      if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });

      const { url } = await storageGet(file.fileKey, 3600);
      return { url, fileName: file.fileName, mimeType: file.mimeType };
    }),

  // ─── Delete a file ───────────────────────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ fileId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [file] = await db
        .select()
        .from(userFiles)
        .where(and(eq(userFiles.id, input.fileId), eq(userFiles.userId, ctx.user.id)))
        .limit(1);

      if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });

      await storageDelete(file.fileKey);
      await db.delete(userFiles).where(eq(userFiles.id, input.fileId));

      return { success: true };
    }),

  // ─── List distinct folder names ──────────────────────────────────────────
  listFolders: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    const rows = await db
      .selectDistinct({ folder: userFiles.folder })
      .from(userFiles)
      .where(eq(userFiles.userId, ctx.user.id))
      .orderBy(userFiles.folder);

    return rows.map((r) => r.folder);
  }),
});
