/**
 * NEXCOM Exchange — Storage integration tests
 *
 * These tests run against a real MinIO instance when S3_ENDPOINT is set and
 * reachable. They are skipped automatically in environments without MinIO.
 *
 * To run locally:
 *   docker run -d -p 9000:9000 -e MINIO_ROOT_USER=nexcom-minio \
 *     -e MINIO_ROOT_PASSWORD=nexcom-minio-secret minio/minio server /data
 *   S3_ENDPOINT=http://localhost:9000 pnpm test server/storage.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  storagePut,
  storageGet,
  storageDelete,
  storageList,
  pingStorage,
  ensureBucket,
  _resetStorageClient,
} from "./storage";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function isMinioReachable(): Promise<boolean> {
  const endpoint = process.env.S3_ENDPOINT ?? "http://minio:9000";
  try {
    const resp = await fetch(`${endpoint}/minio/health/live`, {
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Storage helpers (MinIO / S3)", () => {
  let minioAvailable = false;
  const testPrefix = `test-${Date.now()}`;

  beforeAll(async () => {
    minioAvailable = await isMinioReachable();
    if (!minioAvailable) return;

    // Override env for test isolation
    process.env.S3_BUCKET = "nexcom-test";
    process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID ?? "nexcom-minio";
    process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY ?? "nexcom-minio-secret";
    _resetStorageClient();
    await ensureBucket();
  });

  afterAll(() => {
    _resetStorageClient();
  });

  it("pingStorage returns true when MinIO is reachable", async () => {
    if (!minioAvailable) {
      console.log("  ⚠ MinIO not reachable — skipping storage tests");
      return;
    }
    const ok = await pingStorage();
    expect(ok).toBe(true);
  });

  it("storagePut uploads a text file and returns a URL", async () => {
    if (!minioAvailable) return;
    const key = `${testPrefix}/hello.txt`;
    const { key: returnedKey, url } = await storagePut(key, "hello nexcom", "text/plain");
    expect(returnedKey).toBe(key);
    expect(url).toContain(key);
  });

  it("storagePut uploads a binary buffer", async () => {
    if (!minioAvailable) return;
    const key = `${testPrefix}/binary.bin`;
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const { key: returnedKey } = await storagePut(key, buf, "application/octet-stream");
    expect(returnedKey).toBe(key);
  });

  it("storageGet returns a presigned URL for an existing object", async () => {
    if (!minioAvailable) return;
    const key = `${testPrefix}/hello.txt`;
    const { url } = await storageGet(key, 60);
    expect(url).toContain(key);
    // Presigned URLs contain X-Amz-Signature or similar query params
    expect(url).toMatch(/[?&](X-Amz-Signature|Signature)=/);
  });

  it("storageList returns objects under a prefix", async () => {
    if (!minioAvailable) return;
    const items = await storageList(`${testPrefix}/`, 50);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.every((i) => i.key.startsWith(testPrefix))).toBe(true);
    expect(items.every((i) => typeof i.size === "number")).toBe(true);
  });

  it("storageDelete removes an object", async () => {
    if (!minioAvailable) return;
    const key = `${testPrefix}/binary.bin`;
    await expect(storageDelete(key)).resolves.not.toThrow();
    // After deletion, the list should not contain the deleted key
    const items = await storageList(`${testPrefix}/`, 50);
    expect(items.find((i) => i.key === key)).toBeUndefined();
  });

  it("storagePut normalises leading slashes in keys", async () => {
    if (!minioAvailable) return;
    const { key } = await storagePut(`/${testPrefix}/slash-test.txt`, "data", "text/plain");
    expect(key.startsWith("/")).toBe(false);
    expect(key).toBe(`${testPrefix}/slash-test.txt`);
  });

  it("pingStorage returns false when endpoint is unreachable", async () => {
    if (!minioAvailable) return;
    // Temporarily override to an unreachable endpoint
    const orig = process.env.S3_ENDPOINT;
    process.env.S3_ENDPOINT = "http://127.0.0.1:19999";
    _resetStorageClient();
    const ok = await pingStorage();
    expect(ok).toBe(false);
    // Restore
    process.env.S3_ENDPOINT = orig;
    _resetStorageClient();
  });
});
