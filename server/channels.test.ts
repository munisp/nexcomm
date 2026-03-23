/**
 * channels.test.ts
 * Tests for USSD, WhatsApp, and Telegram tRPC routers
 */
import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import { TRPCError } from "@trpc/server";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeCtx(role: "admin" | "user" | null = null) {
  if (!role) return { user: null };
  return {
    user: {
      id: role === "admin" ? 1 : 2,
      openId: role === "admin" ? "admin-open-id" : "user-open-id",
      name: role === "admin" ? "Admin User" : "Regular User",
      role,
    },
  };
}

const adminCaller = appRouter.createCaller(makeCtx("admin") as any);
const userCaller  = appRouter.createCaller(makeCtx("user") as any);
const anonCaller  = appRouter.createCaller(makeCtx(null) as any);

// ─── USSD Router ─────────────────────────────────────────────────────────────
describe("USSD Router", () => {
  it("getSessionStats: rejects non-admin users", async () => {
    await expect(userCaller.ussd.getSessionStats({})).rejects.toThrow();
  });

  it("getSessionStats: rejects anonymous users", async () => {
    await expect(anonCaller.ussd.getSessionStats({})).rejects.toThrow();
  });

  it("getSessionStats: returns stats for admin", async () => {
    const result = await adminCaller.ussd.getSessionStats({});
    expect(result).toHaveProperty("stats");
    expect(result.stats).toHaveProperty("total_sessions");
    expect(result.stats).toHaveProperty("completed_sessions");
    expect(result.stats).toHaveProperty("active_sessions");
    expect(result.stats).toHaveProperty("unique_users");
    expect(result.stats).toHaveProperty("completion_rate");
    expect(result).toHaveProperty("menuBreakdown");
    expect(Array.isArray(result.menuBreakdown)).toBe(true);
  });

  it("getSessions: returns paginated sessions for admin", async () => {
    const result = await adminCaller.ussd.getSessions({ page: 1, limit: 10 });
    expect(result).toHaveProperty("sessions");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("page");
    expect(Array.isArray(result.sessions)).toBe(true);
    expect(result.page).toBe(1);
  });

  it("getSessions: rejects non-admin", async () => {
    await expect(userCaller.ussd.getSessions({ page: 1, limit: 10 })).rejects.toThrow();
  });
});

// ─── WhatsApp Router ─────────────────────────────────────────────────────────
describe("WhatsApp Router", () => {
  it("getStats: rejects non-admin users", async () => {
    await expect(userCaller.whatsapp.getStats()).rejects.toThrow();
  });

  it("getStats: returns stats for admin", async () => {
    const result = await adminCaller.whatsapp.getStats();
    expect(result).toHaveProperty("totalContacts");
    expect(result).toHaveProperty("totalMessages");
    expect(result).toHaveProperty("inboundMessages");
    expect(result).toHaveProperty("outboundMessages");
    expect(result).toHaveProperty("messagesLast24h");
  });

  it("getContacts: returns paginated contacts for admin", async () => {
    const result = await adminCaller.whatsapp.getContacts({ page: 1, limit: 10 });
    expect(result).toHaveProperty("contacts");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.contacts)).toBe(true);
  });

  it("getContacts: rejects non-admin", async () => {
    await expect(userCaller.whatsapp.getContacts({ page: 1, limit: 10 })).rejects.toThrow();
  });

  it("sendMessage: rejects non-admin", async () => {
    await expect(userCaller.whatsapp.sendMessage({ contactId: 1, message: "test" })).rejects.toThrow();
  });

  it("sendMessage: rejects invalid contactId for admin", async () => {
    // contactId 999999 doesn't exist — should throw NOT_FOUND
    await expect(adminCaller.whatsapp.sendMessage({ contactId: 999999, message: "test" })).rejects.toThrow();
  });
});

// ─── Telegram Router ─────────────────────────────────────────────────────────
describe("Telegram Router", () => {
  it("getStats: rejects non-admin users", async () => {
    await expect(userCaller.telegram.getStats()).rejects.toThrow();
  });

  it("getStats: returns stats for admin", async () => {
    const result = await adminCaller.telegram.getStats();
    expect(result).toHaveProperty("totalContacts");
    expect(result).toHaveProperty("verifiedContacts");
    expect(result).toHaveProperty("totalMessages");
    expect(result).toHaveProperty("inboundMessages");
    expect(result).toHaveProperty("outboundMessages");
    expect(result).toHaveProperty("messagesLast24h");
  });

  it("getContacts: returns paginated contacts for admin", async () => {
    const result = await adminCaller.telegram.getContacts({ page: 1, limit: 10 });
    expect(result).toHaveProperty("contacts");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.contacts)).toBe(true);
  });

  it("getContacts: rejects non-admin", async () => {
    await expect(userCaller.telegram.getContacts({ page: 1, limit: 10 })).rejects.toThrow();
  });

  it("sendMessage: rejects non-admin", async () => {
    await expect(userCaller.telegram.sendMessage({ contactId: 1, message: "test" })).rejects.toThrow();
  });

  it("sendMessage: rejects invalid contactId for admin", async () => {
    await expect(adminCaller.telegram.sendMessage({ contactId: 999999, message: "test" })).rejects.toThrow();
  });
});
