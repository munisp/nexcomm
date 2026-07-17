/**
 * NEXCOM Exchange — S3-compatible storage helpers
 *
 * Replaces the Manus BUILT_IN_FORGE storage proxy with a direct AWS SDK v3
 * client. Works with any S3-compatible backend:
 *   - AWS S3:   set S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
 *   - MinIO:    set S3_BUCKET, S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 *   - Cloudflare R2: set S3_BUCKET, S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
 *
 * No Manus dependencies.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function createS3Client(): S3Client {
  const endpoint = process.env.S3_ENDPOINT ?? undefined;
  const region = process.env.AWS_REGION ?? process.env.S3_REGION ?? "us-east-1";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "minioadmin";
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "minioadmin";
  return new S3Client({
    region,
    endpoint,
    forcePathStyle: !!endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

let _s3: S3Client | null = null;
function getS3(): S3Client {
  if (!_s3) _s3 = createS3Client();
  return _s3;
}

const BUCKET = process.env.S3_BUCKET ?? "nexcom";
const PUBLIC_BASE = process.env.S3_PUBLIC_BASE_URL ?? "";

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function buildPublicUrl(key: string): string {
  if (PUBLIC_BASE) return `${PUBLIC_BASE.replace(/\/+$/, "")}/${key}`;
  const endpoint = process.env.S3_ENDPOINT;
  if (endpoint) return `${endpoint.replace(/\/+$/, "")}/${BUCKET}/${key}`;
  const region = process.env.AWS_REGION ?? "us-east-1";
  return `https://${BUCKET}.s3.${region}.amazonaws.com/${key}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const body = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  await getS3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
  return { key, url: buildPublicUrl(key) };
}

export async function storageGet(
  relKey: string,
  expiresIn = 3600
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const url = await getSignedUrl(getS3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
  return { key, url };
}

export function _resetStorageClient() { _s3 = null; }
