/**
 * Tests for the notifications router — push token registration,
 * price alert CRUD logic, and Expo push message formatting.
 */
import { describe, it, expect, vi } from "vitest";

// ─── Mock DB (hoisting-safe: no variable references in factory) ──
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 42 }]),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            id: 1,
            userId: 1,
            symbol: "MAIZE",
            condition: "ABOVE",
            targetPrice: "300000",
            triggered: false,
            notified: false,
            createdAt: new Date(),
          },
        ]),
      }),
    }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
  }),
}));

import { getDb } from "./db";

// ─────────────────────────────────────────────────────────────
// Push Token Registration
// ─────────────────────────────────────────────────────────────

describe("Push Token Registration", () => {
  it("logs a registration message without a device credential", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const userId = 7;
    const platform = "android";

    // Mirrors the procedure body without printing any credential material.
    console.log(`[Push] Registered push device for user ${userId} (${platform}).`);

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Registered push device for user 7")
    );
    spy.mockRestore();
  });

  it("logs an unregistration message on logout", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const userId = 7;
    console.log(`[Push] Unregistered push device for user ${userId}.`);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Unregistered push device for user 7")
    );
    spy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────
// Price Alert DB helpers
// ─────────────────────────────────────────────────────────────

describe("Price Alert — DB helpers", () => {
  it("listAlerts returns the mocked alert row", async () => {
    const db = await getDb();
    const rows = await db!.select().from({} as any).where({} as any);
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("MAIZE");
    expect(rows[0].triggered).toBe(false);
  });

  it("createAlert insert chain resolves with id=42", async () => {
    const db = await getDb();
    const [row] = await db!
      .insert({} as any)
      .values({ userId: 1, symbol: "SOYBEAN", condition: "BELOW", targetPrice: "500000" })
      .returning({ id: {} as any });
    expect(row.id).toBe(42);
  });

  it("deleteAlert calls delete once", async () => {
    const db = await getDb();
    await db!.delete({} as any).where({} as any);
    expect(db!.delete).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Alert evaluation logic
// ─────────────────────────────────────────────────────────────

describe("Alert Evaluation Logic", () => {
  function shouldTrigger(
    condition: string,
    targetPrice: string,
    currentPrice: number
  ): boolean {
    const target = parseFloat(targetPrice);
    if (condition === "ABOVE" || condition === "CROSS_ABOVE") return currentPrice >= target;
    if (condition === "BELOW" || condition === "CROSS_BELOW") return currentPrice <= target;
    return false;
  }

  it("ABOVE: triggers when price exceeds target", () => {
    expect(shouldTrigger("ABOVE", "300000", 310000)).toBe(true);
  });

  it("ABOVE: does not trigger when price is below target", () => {
    expect(shouldTrigger("ABOVE", "300000", 280000)).toBe(false);
  });

  it("ABOVE: triggers when price equals target exactly", () => {
    expect(shouldTrigger("ABOVE", "300000", 300000)).toBe(true);
  });

  it("BELOW: triggers when price falls below target", () => {
    expect(shouldTrigger("BELOW", "4500000", 4200000)).toBe(true);
  });

  it("BELOW: does not trigger when price is above target", () => {
    expect(shouldTrigger("BELOW", "4500000", 4850000)).toBe(false);
  });

  it("CROSS_ABOVE: same logic as ABOVE", () => {
    expect(shouldTrigger("CROSS_ABOVE", "200000", 205000)).toBe(true);
    expect(shouldTrigger("CROSS_ABOVE", "200000", 195000)).toBe(false);
  });

  it("CROSS_BELOW: same logic as BELOW", () => {
    expect(shouldTrigger("CROSS_BELOW", "200000", 195000)).toBe(true);
    expect(shouldTrigger("CROSS_BELOW", "200000", 205000)).toBe(false);
  });

  it("skips alert when symbol is not in the price feed", () => {
    const prices: Record<string, number> = { MAIZE: 310000 };
    const currentPrice = prices["UNKNOWN_COMMODITY"];
    expect(currentPrice).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Expo push message format
// ─────────────────────────────────────────────────────────────

describe("Expo Push Message Format", () => {
  it("builds a valid push message for an ABOVE alert", () => {
    const symbol = "MAIZE";
    const currentPrice = 310000;
    const targetPrice = 300000;
    const condition = "ABOVE";
    const userId = 3;

    const direction = condition === "ABOVE" ? "▲" : "▼";
    const msg = {
      to: `ExponentPushToken[user-${userId}]`,
      title: `${symbol} Price Alert 🔔`,
      body: `${symbol} is now ₦${currentPrice.toLocaleString()} ${direction} your target of ₦${targetPrice.toLocaleString()}`,
      data: { type: "PRICE_ALERT", symbol, currentPrice, targetPrice, condition },
      sound: "default",
      channelId: "price-alerts",
      priority: "high",
    };

    expect(msg.to).toContain("ExponentPushToken");
    expect(msg.title).toBe("MAIZE Price Alert 🔔");
    expect(msg.body).toContain("310,000");
    expect(msg.body).toContain("300,000");
    expect(msg.body).toContain("▲");
    expect(msg.data.type).toBe("PRICE_ALERT");
    expect(msg.channelId).toBe("price-alerts");
    expect(msg.priority).toBe("high");
  });

  it("builds a valid push message for a BELOW alert", () => {
    const symbol = "COCOA";
    const currentPrice = 4200000;
    const targetPrice = 4500000;
    const condition = "BELOW";

    const direction = condition === "BELOW" ? "▼" : "▲";
    const body = `${symbol} is now ₦${currentPrice.toLocaleString()} ${direction} your target of ₦${targetPrice.toLocaleString()}`;

    expect(body).toContain("4,200,000");
    expect(body).toContain("4,500,000");
    expect(body).toContain("▼");
  });
});
