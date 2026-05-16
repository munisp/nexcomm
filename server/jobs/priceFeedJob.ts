/**
 * priceFeedJob.ts
 * Polls Yahoo Finance every 5 minutes for live commodity futures prices,
 * upserts them into the live_prices table, then evaluates price alerts
 * and dispatches Expo push notifications for triggered alerts.
 */
import { callDataApi } from "../_core/dataApi";
import { getDb } from "../db";
import { livePrices, priceAlerts, pushTokens } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { emitPriceUpdated } from "../kafka/kafkaProducer";

// Mapping: NEXCOM symbol → Yahoo Finance futures symbol + metadata
const PRICE_FEED_MAP: Array<{
  symbol: string;
  name: string;
  yahooSymbol: string;
  assetClass: string;
  currency: string;
  basePriceFallback: number;
}> = [
  { symbol: "WHEAT-SPOT",    name: "Hard Red Wheat",        yahooSymbol: "ZW=F",  assetClass: "COMMODITY", currency: "USD", basePriceFallback: 215 },
  { symbol: "MAIZE-NG-SPOT", name: "White Maize (Nigeria)", yahooSymbol: "ZC=F",  assetClass: "COMMODITY", currency: "USD", basePriceFallback: 285 },
  { symbol: "SOYBEAN-SPOT",  name: "Soybean",               yahooSymbol: "ZS=F",  assetClass: "COMMODITY", currency: "USD", basePriceFallback: 430 },
  { symbol: "COCOA-SPOT",    name: "Cocoa",                  yahooSymbol: "CC=F",  assetClass: "COMMODITY", currency: "USD", basePriceFallback: 3000 },
  { symbol: "COFFEE-SPOT",   name: "Coffee (Arabica)",       yahooSymbol: "KC=F",  assetClass: "COMMODITY", currency: "USD", basePriceFallback: 280 },
  { symbol: "SUGAR-SPOT",    name: "Raw Sugar",              yahooSymbol: "SB=F",  assetClass: "COMMODITY", currency: "USD", basePriceFallback: 14 },
  { symbol: "COTTON-SPOT",   name: "Cotton",                 yahooSymbol: "CT=F",  assetClass: "COMMODITY", currency: "USD", basePriceFallback: 65 },
  { symbol: "PALMOIL-SPOT",  name: "Crude Palm Oil",         yahooSymbol: "",      assetClass: "COMMODITY", currency: "USD", basePriceFallback: 870 },
  { symbol: "GOLD-SPOT",     name: "Gold",                   yahooSymbol: "GC=F",  assetClass: "METALS",    currency: "USD", basePriceFallback: 2000 },
  { symbol: "SILVER-SPOT",   name: "Silver",                 yahooSymbol: "SI=F",  assetClass: "METALS",    currency: "USD", basePriceFallback: 25 },
  { symbol: "COPPER-SPOT",   name: "Copper",                 yahooSymbol: "HG=F",  assetClass: "METALS",    currency: "USD", basePriceFallback: 4.5 },
  { symbol: "CRUDE-OIL-SPOT",name: "Crude Oil (WTI)",        yahooSymbol: "CL=F",  assetClass: "ENERGY",    currency: "USD", basePriceFallback: 75 },
];

async function fetchYahooPrice(yahooSymbol: string): Promise<{
  price: number;
  previousClose: number | null;
  high: number | null;
  low: number | null;
  currency: string;
} | null> {
  try {
    const result = await callDataApi("YahooFinance/get_stock_chart", {
      query: {
        symbol: yahooSymbol,
        region: "US",
        interval: "1d",
        range: "1d",
      },
    }) as Record<string, unknown>;

    const jsonData = result?.jsonData;
    const parsed = typeof jsonData === "string" ? JSON.parse(jsonData) : jsonData as Record<string, unknown>;
    const meta = (parsed as Record<string, unknown>)?.chart as Record<string, unknown>;
    const chartResult = (meta?.result as unknown[])?.[0] as Record<string, unknown>;
    const chartMeta = chartResult?.meta as Record<string, unknown>;

    if (!chartMeta?.regularMarketPrice) return null;

    // Some symbols use USX (cents) — convert to USD
    const rawPrice = chartMeta.regularMarketPrice as number;
    const rawCurrency = (chartMeta.currency as string) || "USD";
    const price = rawCurrency === "USX" ? rawPrice / 100 : rawPrice;

    const rawPrevClose = chartMeta.chartPreviousClose as number | undefined;
    const previousClose = rawPrevClose != null
      ? (rawCurrency === "USX" ? rawPrevClose / 100 : rawPrevClose)
      : null;

    const rawHigh = chartMeta.regularMarketDayHigh as number | undefined;
    const rawLow = chartMeta.regularMarketDayLow as number | undefined;
    const high = rawHigh != null ? (rawCurrency === "USX" ? rawHigh / 100 : rawHigh) : null;
    const low = rawLow != null ? (rawCurrency === "USX" ? rawLow / 100 : rawLow) : null;

    return { price, previousClose, high, low, currency: "USD" };
  } catch {
    return null;
  }
}

// ─── Alert Evaluation & Push Notifications ──────────────────────────────────

async function evaluatePriceAlerts(prices: Record<string, number>): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const activeAlerts = await db.select().from(priceAlerts).where(eq(priceAlerts.triggered, false));
  let triggeredCount = 0;

  for (const alert of activeAlerts) {
    const currentPrice = prices[alert.symbol];
    if (currentPrice === undefined) continue;

    const target = parseFloat(String(alert.targetPrice));
    let shouldTrigger = false;
    if (alert.condition === "ABOVE" || alert.condition === "CROSS_ABOVE") shouldTrigger = currentPrice >= target;
    else if (alert.condition === "BELOW" || alert.condition === "CROSS_BELOW") shouldTrigger = currentPrice <= target;
    if (!shouldTrigger) continue;

    // Look up active push tokens for this user
    const tokens = await db.select().from(pushTokens)
      .where(and(eq(pushTokens.userId, alert.userId), eq(pushTokens.isActive, true)));

    if (tokens.length > 0) {
      const direction = (alert.condition === "ABOVE" || alert.condition === "CROSS_ABOVE") ? "▲" : "▼";
      const messages = tokens.map(t => ({
        to: t.token,
        title: `${alert.symbol} Price Alert 🔔`,
        body: `${alert.symbol} is now ₦${currentPrice.toLocaleString()} ${direction} your target of ₦${target.toLocaleString()}`,
        data: { type: "PRICE_ALERT", symbol: alert.symbol, currentPrice, targetPrice: target },
        sound: "default",
        channelId: "price-alerts",
        priority: "high",
      }));
      try {
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json", "Accept-Encoding": "gzip, deflate" },
          body: JSON.stringify(messages),
        });
      } catch (err) {
        console.error("[PriceFeed] Push notification dispatch failed:", err);
      }
    }

    // Mark alert as triggered
    await db.update(priceAlerts)
      .set({ triggered: true, notified: true })
      .where(eq(priceAlerts.id, alert.id));
    triggeredCount++;
    console.log(`[PriceFeed] Alert triggered: ${alert.symbol} ${alert.condition} ${target} (current: ${currentPrice})`);
  }

  if (triggeredCount > 0) {
    console.log(`[PriceFeed] ${triggeredCount} price alert(s) triggered and notifications sent`);
  }
}

// ─── Main Price Feed Job ─────────────────────────────────────────────────────

export async function runPriceFeedJob(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[PriceFeed] Database not available, skipping price update");
    return;
  }

  let updated = 0;
  let fallback = 0;
  const currentPrices: Record<string, number> = {};

  for (const entry of PRICE_FEED_MAP) {
    try {
      let priceData: { price: number; previousClose: number | null; high: number | null; low: number | null; currency: string } | null = null;

      if (entry.yahooSymbol) {
        priceData = await fetchYahooPrice(entry.yahooSymbol);
      }

      const price = priceData?.price ?? entry.basePriceFallback;
      currentPrices[entry.symbol] = price;

      const previousClose = priceData?.previousClose ?? null;
      const change = previousClose != null ? price - previousClose : null;
      const changePct = previousClose != null && previousClose !== 0
        ? ((price - previousClose) / previousClose) * 100
        : null;

      await db
        .insert(livePrices)
        .values({
          symbol: entry.symbol,
          name: entry.name,
          price: price.toFixed(6),
          previousClose: previousClose?.toFixed(6) ?? null,
          change: change?.toFixed(6) ?? null,
          changePct: changePct?.toFixed(4) ?? null,
          high: priceData?.high?.toFixed(6) ?? null,
          low: priceData?.low?.toFixed(6) ?? null,
          currency: entry.currency,
          source: entry.yahooSymbol ? "yahoo" : "fallback",
          yahooSymbol: entry.yahooSymbol || null,
          assetClass: entry.assetClass,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: livePrices.symbol,
          set: {
            price: price.toFixed(6),
            previousClose: previousClose?.toFixed(6) ?? null,
            change: change?.toFixed(6) ?? null,
            changePct: changePct?.toFixed(4) ?? null,
            high: priceData?.high?.toFixed(6) ?? null,
            low: priceData?.low?.toFixed(6) ?? null,
            source: entry.yahooSymbol ? "yahoo" : "fallback",
            updatedAt: new Date(),
          },
        });

      if (priceData) {
        updated++;
        // Emit Kafka price.updated event for downstream consumers (market-data service, analytics)
        emitPriceUpdated({
          symbol: entry.symbol,
          price,
          change: change ?? 0,
          changePercent: changePct ?? 0,
          volume: 0, // Yahoo Finance futures don't always provide volume
        }).catch(e => console.warn("[Kafka] emitPriceUpdated failed:", (e as Error).message));
      } else fallback++;
    } catch (err) {
      console.error(`[PriceFeed] Failed to update ${entry.symbol}:`, err);
    }
  }

  console.log(`[PriceFeed] Updated ${updated} live prices, ${fallback} fallback prices`);

  // Evaluate price alerts after each feed cycle
  evaluatePriceAlerts(currentPrices).catch(err =>
    console.error("[PriceFeed] Alert evaluation failed:", err)
  );
}

let _priceFeedInterval: ReturnType<typeof setInterval> | null = null;

export function startPriceFeedJob(): void {
  if (_priceFeedInterval) return; // already running

  console.log("[PriceFeed] Starting price feed job (5-minute interval)");

  // Run immediately on startup
  runPriceFeedJob().catch(err => console.error("[PriceFeed] Initial run failed:", err));

  // Then every 5 minutes
  _priceFeedInterval = setInterval(() => {
    runPriceFeedJob().catch(err => console.error("[PriceFeed] Scheduled run failed:", err));
  }, 5 * 60 * 1000);
}

export function stopPriceFeedJob(): void {
  if (_priceFeedInterval) {
    clearInterval(_priceFeedInterval);
    _priceFeedInterval = null;
  }
}
