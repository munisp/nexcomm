import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { cropProductionReports } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";

export const cropReportsRouter = router({
  list: publicProcedure
    .input(z.object({
      cropSymbol: z.string().optional(),
      reportType: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return DEMO_REPORTS;
      try {
        const rows = await db.select().from(cropProductionReports)
          .orderBy(desc(cropProductionReports.publishedAt)).limit(50);
        return rows.length > 0 ? rows : DEMO_REPORTS;
      } catch { return DEMO_REPORTS; }
    }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return DEMO_REPORTS.find(r => r.id === input.id) ?? null;
      try {
        const rows = await db.select().from(cropProductionReports)
          .where(eq(cropProductionReports.id, input.id)).limit(1);
        return rows[0] ?? null;
      } catch { return null; }
    }),

  summary: publicProcedure.query(async () => {
    return DEMO_SUMMARY;
  }),

  indices: publicProcedure.query(async () => {
    return DEMO_INDICES;
  }),
});

const DEMO_INDICES = [
  { id: 1, indexName: "NEXCOM Grains Index", cropSymbol: "GRAINS", indexValue: "1284.50", changePercent: "2.40", sentiment: "BULLISH", baseDate: new Date("2020-01-01"), updatedAt: new Date() },
  { id: 2, indexName: "NEXCOM Oilseeds Index", cropSymbol: "OILSEEDS", indexValue: "892.30", changePercent: "-0.80", sentiment: "BEARISH", baseDate: new Date("2020-01-01"), updatedAt: new Date() },
  { id: 3, indexName: "NEXCOM Spices Index", cropSymbol: "SPICES", indexValue: "2140.75", changePercent: "5.20", sentiment: "BULLISH", baseDate: new Date("2020-01-01"), updatedAt: new Date() },
  { id: 4, indexName: "NEXCOM Soft Commodities", cropSymbol: "SOFTS", indexValue: "1567.20", changePercent: "1.10", sentiment: "NEUTRAL", baseDate: new Date("2020-01-01"), updatedAt: new Date() },
];

const DEMO_REPORTS = [
  {
    id: 1, reportType: "YIELD_FORECAST" as const, cropSymbol: "MAIZE",
    cropName: "Maize (White)", reportingPeriod: "2025-Q3",
    coverageRegion: "NIGERIA", productionMt: "10800000", yieldMtPerHa: "1.8500",
    areaHarvestedHa: "5837838", stocksMt: "2100000", exportsMt: "45000",
    importsMt: "180000", priceNgnPerMt: "285000", priceChangePercent: "4.2000",
    outlookSummary: "2025 wet season maize production is forecast at 10.8 million MT, up 3.2% from 2024 due to improved seed adoption and favourable rainfall in the North West. Key growing states of Kano, Kaduna, and Niger are reporting above-average crop conditions. Price pressure expected to ease in Q4 as harvest volumes arrive at registered warehouses.",
    spatialDataUrl: null, publishedAt: new Date("2025-07-15"), createdAt: new Date(),
  },
  {
    id: 2, reportType: "YIELD_FORECAST" as const, cropSymbol: "SOYBEAN",
    cropName: "Soybean", reportingPeriod: "2025-Q3",
    coverageRegion: "NIGERIA", productionMt: "3200000", yieldMtPerHa: "1.1200",
    areaHarvestedHa: "2857143", stocksMt: "480000", exportsMt: "120000",
    importsMt: "85000", priceNgnPerMt: "420000", priceChangePercent: "-1.8000",
    outlookSummary: "Soybean production for 2025 is forecast at 3.2 million MT, broadly in line with 2024. The Benue and Taraba corridors are showing strong crop conditions. Prices have softened slightly due to improved supply from the 2024 carryover stocks. Demand from domestic crushing mills remains robust.",
    spatialDataUrl: null, publishedAt: new Date("2025-07-15"), createdAt: new Date(),
  },
  {
    id: 3, reportType: "PRICE_OUTLOOK" as const, cropSymbol: "GINGER",
    cropName: "Ginger (Dried)", reportingPeriod: "2025-Q3",
    coverageRegion: "NIGERIA", productionMt: "620000", yieldMtPerHa: "4.2000",
    areaHarvestedHa: "147619", stocksMt: "95000", exportsMt: "380000",
    importsMt: "0", priceNgnPerMt: "1850000", priceChangePercent: "12.5000",
    outlookSummary: "Nigeria remains the world's largest ginger exporter. 2025 production is expected to reach 620,000 MT driven by strong export demand from India and China. Prices have surged 12.5% YTD due to supply disruptions in competing producers. Kaduna and Nasarawa remain the primary production zones.",
    spatialDataUrl: null, publishedAt: new Date("2025-07-10"), createdAt: new Date(),
  },
  {
    id: 4, reportType: "CROP_CONDITIONS" as const, cropSymbol: "COCOA",
    cropName: "Cocoa", reportingPeriod: "2025-Q3",
    coverageRegion: "NIGERIA", productionMt: "280000", yieldMtPerHa: "0.4200",
    areaHarvestedHa: "666667", stocksMt: "42000", exportsMt: "240000",
    importsMt: "0", priceNgnPerMt: "4200000", priceChangePercent: "28.4000",
    outlookSummary: "Nigerian cocoa production continues to recover from the 2023-24 drought impact. Crop conditions in Ondo, Cross River, and Ogun states are rated as FAIR to GOOD. Global cocoa prices remain at multi-decade highs, providing strong export revenue. Quality improvement programs are showing results with a 15% increase in Grade 1 certification.",
    spatialDataUrl: null, publishedAt: new Date("2025-07-08"), createdAt: new Date(),
  },
  {
    id: 5, reportType: "STORAGE_STOCKS" as const, cropSymbol: "SORGHUM",
    cropName: "Sorghum", reportingPeriod: "2025-Q2",
    coverageRegion: "NIGERIA", productionMt: "6800000", yieldMtPerHa: "1.2400",
    areaHarvestedHa: "5483871", stocksMt: "1850000", exportsMt: "12000",
    importsMt: "95000", priceNgnPerMt: "195000", priceChangePercent: "2.1000",
    outlookSummary: "Sorghum stocks at registered NEXCOM warehouses stand at 1.85 million MT as of Q2 2025. Demand from the brewing and animal feed sectors remains strong. Prices are stable with a slight upward bias. The Northern states of Borno, Yobe, and Jigawa account for 68% of registered warehouse stocks.",
    spatialDataUrl: null, publishedAt: new Date("2025-06-30"), createdAt: new Date(),
  },
];

const DEMO_SUMMARY = {
  totalReports: 24,
  commoditiesCovered: 12,
  cropsCovered: 8,
  regionsCovered: 6,
  latestPeriod: "2025-Q3",
  lastUpdated: new Date("2025-07-15"),
  highlights: [
    { crop: "GINGER", change: "+12.5%", direction: "up", note: "Export demand surge" },
    { crop: "COCOA", change: "+28.4%", direction: "up", note: "Global price rally" },
    { crop: "SOYBEAN", change: "-1.8%", direction: "down", note: "Improved supply" },
    { crop: "MAIZE", change: "+4.2%", direction: "up", note: "Wet season forecast" },
  ],
};
