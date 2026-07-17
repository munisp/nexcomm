/**
 * NEXCOM Exchange — S3-compatible storage helpers
 *
 * Works with any S3-compatible backend:
 *   - MinIO (default):  S3_ENDPOINT=http://minio:9000, path-style addressing
 *   - AWS S3:           leave S3_ENDPOINT unset, virtual-hosted addressing
 *   - Cloudflare R2:    S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
 *   - Backblaze B2:     S3_ENDPOINT=https://s3.<region>.backblazeb2.com
 *
 * Environment variables (all have defaults for Docker Compose):
 *   S3_BUCKET              nexcom-files
 *   S3_ENDPOINT            http://minio:9000
 *   S3_PUBLIC_BASE_URL     http://localhost:9000/nexcom-files
 *   AWS_ACCESS_KEY_ID      nexcom-minio
 *   AWS_SECRET_ACCESS_KEY  nexcom-minio-secret
 *   AWS_REGION             us-east-1
 *
 * No Manus dependencies.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./_core/env";

// ── Client factory ────────────────────────────────────────────────────────────

function createS3Client(): S3Client {
  const endpoint = ENV.s3Endpoint || undefined;
  // Use path-style addressing for MinIO and any custom endpoint.
  // AWS S3 uses virtual-hosted style (no forcePathStyle).
  const forcePathStyle = !!endpoint;
  return new S3Client({
    region: ENV.awsRegion,
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: ENV.awsAccessKeyId || "nexcom-minio",
      secretAccessKey: ENV.awsSecretAccessKey || "nexcom-minio-secret",
    },
  });
}

let _s3: S3Client | null = null;
export function getS3(): S3Client {
  if (!_s3) _s3 = createS3Client();
  return _s3;
}

/** Reset the singleton (used in tests). */
export function _resetStorageClient() {
  _s3 = null;
}

// ── Bucket name & public URL ──────────────────────────────────────────────────

function getBucket(): string {
  return ENV.s3Bucket || "nexcom-files";
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

/**
 * Build a public (non-presigned) URL for a stored object.
 *
 * Priority:
 *   1. S3_PUBLIC_BASE_URL env var (explicit CDN / reverse-proxy URL)
 *   2. Custom endpoint (MinIO / R2 / B2) — path-style URL
 *   3. AWS S3 virtual-hosted URL
 */
function buildPublicUrl(key: string): string {
  const publicBase = ENV.s3PublicBaseUrl;
  if (publicBase) return `${publicBase.replace(/\/+$/, "")}/${key}`;
  const endpoint = ENV.s3Endpoint;
  if (endpoint) return `${endpoint.replace(/\/+$/, "")}/${getBucket()}/${key}`;
  return `https://${getBucket()}.s3.${ENV.awsRegion}.amazonaws.com/${key}`;
}

// ── Bucket auto-creation (MinIO / dev) ────────────────────────────────────────

let _bucketEnsured = false;

/**
 * Ensure the configured bucket exists.
 * Silently succeeds if the bucket already exists or if we cannot connect.
 * In production (AWS S3), the bucket should be pre-created via Terraform/CDK.
 */
export async function ensureBucket(): Promise<void> {
  if (_bucketEnsured) return;
  const bucket = getBucket();
  const s3 = getS3();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    _bucketEnsured = true;
    console.log(`[Storage] Bucket "${bucket}" exists`);
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name;
    if (code === "NotFound" || code === "NoSuchBucket") {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: bucket }));
        _bucketEnsured = true;
        console.log(`[Storage] Bucket "${bucket}" created`);
      } catch (createErr) {
        console.warn(`[Storage] Could not create bucket "${bucket}":`, (createErr as Error).message);
      }
    } else {
      // Connection refused, credentials wrong, etc. — log and continue.
      console.warn(`[Storage] Bucket check failed (${code}):`, (err as Error).message);
    }
  }
}

// ── Health check ──────────────────────────────────────────────────────────────

/**
 * Ping the storage backend.
 * Returns true if the bucket is reachable, false otherwise.
 */
export async function pingStorage(): Promise<boolean> {
  try {
    const s3 = getS3();
    await s3.send(new HeadBucketCommand({ Bucket: getBucket() }));
    return true;
  } catch {
    return false;
  }
}

// ── Core operations ───────────────────────────────────────────────────────────

/**
 * Upload bytes to S3/MinIO.
 *
 * @param relKey      Object key relative to bucket root, e.g. "users/42/avatar.png"
 * @param data        Buffer, Uint8Array, or UTF-8 string
 * @param contentType MIME type, defaults to "application/octet-stream"
 * @returns           { key, url } where url is the public (non-presigned) URL
 *
 * @example
 *   const { url } = await storagePut(`kyc/${userId}/id-front.jpg`, buffer, "image/jpeg");
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  await ensureBucket();
  const key = normalizeKey(relKey);
  const body = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return { key, url: buildPublicUrl(key) };
}

/**
 * Generate a presigned GET URL for a stored object.
 *
 * @param relKey    Object key relative to bucket root
 * @param expiresIn Expiry in seconds (default 1 hour)
 * @returns         { key, url } where url is a time-limited presigned URL
 */
export async function storageGet(
  relKey: string,
  expiresIn = 3600
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const url = await getSignedUrl(
    getS3(),
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
    { expiresIn }
  );
  return { key, url };
}

/**
 * Delete an object from S3/MinIO.
 *
 * @param relKey  Object key relative to bucket root
 */
export async function storageDelete(relKey: string): Promise<void> {
  const key = normalizeKey(relKey);
  await getS3().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

/**
 * List objects under a key prefix.
 *
 * @param prefix   Key prefix to list, e.g. "users/42/"
 * @param maxKeys  Maximum number of keys to return (default 100)
 * @returns        Array of { key, size, lastModified }
 */
export async function storageList(
  prefix: string,
  maxKeys = 100
): Promise<Array<{ key: string; size: number; lastModified: Date | undefined }>> {
  const resp = await getS3().send(
    new ListObjectsV2Command({
      Bucket: getBucket(),
      Prefix: normalizeKey(prefix),
      MaxKeys: maxKeys,
    })
  );
  return (resp.Contents ?? []).map((obj) => ({
    key: obj.Key ?? "",
    size: obj.Size ?? 0,
    lastModified: obj.LastModified,
  }));
}

/**
 * Generate a presigned PUT URL so the browser can upload directly to S3/MinIO.
 * @param relKey      Relative key (will be normalised)
 * @param contentType MIME type of the file
 * @param expiresIn   Seconds until the URL expires (default 900 = 15 min)
 */
export async function getPresignedUploadUrl(
  relKey: string,
  contentType: string,
  expiresIn = 900
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: getBucket(),
    Key: normalizeKey(relKey),
    ContentType: contentType,
  });
  return getSignedUrl(getS3(), cmd, { expiresIn });
}
