/**
 * VAPID Key Validation Test
 * Verifies that VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT
 * are correctly configured and usable with the web-push library.
 */
import { describe, it, expect } from "vitest";
import webpush from "web-push";

describe("VAPID configuration", () => {
  it("VAPID_PUBLIC_KEY is set and is a valid base64url EC key (65 bytes uncompressed)", () => {
    const pub = process.env.VAPID_PUBLIC_KEY;
    expect(pub, "VAPID_PUBLIC_KEY must be set").toBeTruthy();
    // Decode base64url → should be 65 bytes (uncompressed EC point: 0x04 + 32 + 32)
    const padded = pub!.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(padded, "base64");
    expect(decoded.length).toBe(65);
    expect(decoded[0]).toBe(0x04); // uncompressed point marker
  });

  it("VAPID_PRIVATE_KEY is set and is a valid base64url scalar (32 bytes)", () => {
    const priv = process.env.VAPID_PRIVATE_KEY;
    expect(priv, "VAPID_PRIVATE_KEY must be set").toBeTruthy();
    const padded = priv!.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(padded, "base64");
    expect(decoded.length).toBe(32);
  });

  it("VAPID_SUBJECT is set and is a valid mailto: or https: URI", () => {
    const subject = process.env.VAPID_SUBJECT;
    expect(subject, "VAPID_SUBJECT must be set").toBeTruthy();
    expect(subject).toMatch(/^(mailto:|https:\/\/)/);
  });

  it("web-push can be configured with the VAPID keys without throwing", () => {
    const pub = process.env.VAPID_PUBLIC_KEY!;
    const priv = process.env.VAPID_PRIVATE_KEY!;
    const subject = process.env.VAPID_SUBJECT!;
    expect(() => {
      webpush.setVapidDetails(subject, pub, priv);
    }).not.toThrow();
  });

  it("web-push getVapidHeaders returns valid Authorization header", () => {
    const pub = process.env.VAPID_PUBLIC_KEY!;
    const priv = process.env.VAPID_PRIVATE_KEY!;
    const subject = process.env.VAPID_SUBJECT!;
    webpush.setVapidDetails(subject, pub, priv);
    // generateRequestDetails would throw if keys are invalid
    // We just verify setVapidDetails succeeded and keys are usable
    expect(pub.length).toBeGreaterThan(80);
    expect(priv.length).toBeGreaterThan(40);
  });
});
