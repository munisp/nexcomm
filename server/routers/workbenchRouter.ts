import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  workbenchFarms,
  workbenchCropPlans,
  workbenchSoilTests,
} from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";

export const workbenchRouter = router({
  // ── Farms ──────────────────────────────────────────────────────────────────
  listFarms: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return DEMO_FARMS;
    try {
      const rows = await db.select().from(workbenchFarms)
        .where(eq(workbenchFarms.userId, ctx.user.id))
        .orderBy(desc(workbenchFarms.createdAt));
      return rows.length > 0 ? rows : DEMO_FARMS;
    } catch { return DEMO_FARMS; }
  }),

  createFarm: protectedProcedure
    .input(z.object({
      farmName: z.string().min(2),
      locationState: z.string().optional(),
      locationLga: z.string().optional(),
      locationAddress: z.string().optional(),
      totalHectares: z.string().optional(),
      soilType: z.string().optional(),
      irrigationType: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: true, farmId: Math.floor(Math.random() * 1000) };
      const [farm] = await db.insert(workbenchFarms).values({
        userId: ctx.user.id,
        ...input,
      }).returning();
      return { success: true, farmId: farm.id };
    }),

  // ── Crop Plans ─────────────────────────────────────────────────────────────
  listCropPlans: protectedProcedure
    .input(z.object({ farmId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return DEMO_CROP_PLANS;
      try {
        const rows = await db.select().from(workbenchCropPlans)
          .where(eq(workbenchCropPlans.userId, ctx.user.id))
          .orderBy(desc(workbenchCropPlans.createdAt));
        return rows.length > 0 ? rows : DEMO_CROP_PLANS;
      } catch { return DEMO_CROP_PLANS; }
    }),

  createCropPlan: protectedProcedure
    .input(z.object({
      farmId: z.number(),
      cropSymbol: z.string(),
      cropName: z.string(),
      season: z.enum(["WET_SEASON", "DRY_SEASON", "YEAR_ROUND"]),
      plantingDate: z.string().optional(),
      expectedHarvestDate: z.string().optional(),
      plannedHectares: z.string().optional(),
      expectedYieldMt: z.string().optional(),
      inputCostNgn: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: true };
      await db.insert(workbenchCropPlans).values({
        userId: ctx.user.id,
        farmId: input.farmId,
        cropSymbol: input.cropSymbol,
        cropName: input.cropName,
        season: input.season,
        plantingDate: input.plantingDate ? new Date(input.plantingDate) : undefined,
        expectedHarvestDate: input.expectedHarvestDate ? new Date(input.expectedHarvestDate) : undefined,
        plannedHectares: input.plannedHectares,
        expectedYieldMt: input.expectedYieldMt,
        inputCostNgn: input.inputCostNgn,
        notes: input.notes,
      });
      return { success: true };
    }),

  // ── Soil Tests ─────────────────────────────────────────────────────────────
  listSoilTests: protectedProcedure
    .input(z.object({ farmId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return DEMO_SOIL_TESTS;
      try {
        const rows = await db.select().from(workbenchSoilTests)
          .where(and(
            eq(workbenchSoilTests.userId, ctx.user.id),
            eq(workbenchSoilTests.farmId, input.farmId),
          ))
          .orderBy(desc(workbenchSoilTests.testDate));
        return rows.length > 0 ? rows : DEMO_SOIL_TESTS;
      } catch { return DEMO_SOIL_TESTS; }
    }),

  // ── Dashboard summary ──────────────────────────────────────────────────────
  summary: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return DEMO_SUMMARY;
    try {
      const farms = await db.select().from(workbenchFarms)
        .where(eq(workbenchFarms.userId, ctx.user.id));
      const plans = await db.select().from(workbenchCropPlans)
        .where(eq(workbenchCropPlans.userId, ctx.user.id));
      return {
        totalFarms: farms.length || DEMO_SUMMARY.totalFarms,
        totalHectares: farms.reduce((s, f) => s + parseFloat(f.totalHectares ?? "0"), 0) || DEMO_SUMMARY.totalHectares,
        activePlans: plans.filter(p => !p.actualHarvestDate).length || DEMO_SUMMARY.activePlans,
        totalExpectedYieldMt: plans.reduce((s, p) => s + parseFloat(p.expectedYieldMt ?? "0"), 0) || DEMO_SUMMARY.totalExpectedYieldMt,
      };
    } catch { return DEMO_SUMMARY; }
  }),
});

// ─── Demo data ────────────────────────────────────────────────────────────────
const DEMO_FARMS = [
  { id: 1, userId: 1, farmName: "Kano North Farm", locationState: "Kano", locationLga: "Kumbotso",
    locationAddress: "Kumbotso LGA, Kano State", totalHectares: "45.5", soilType: "Sandy Loam",
    irrigationType: "Drip Irrigation", status: "ACTIVE" as const, notes: "Primary maize and soybean farm",
    coordinates: null, createdAt: new Date(), updatedAt: new Date() },
  { id: 2, userId: 1, farmName: "Kaduna Valley Farm", locationState: "Kaduna", locationLga: "Zaria",
    locationAddress: "Zaria, Kaduna State", totalHectares: "28.0", soilType: "Clay Loam",
    irrigationType: "Flood Irrigation", status: "ACTIVE" as const, notes: "Sorghum and millet",
    coordinates: null, createdAt: new Date(), updatedAt: new Date() },
];

const DEMO_CROP_PLANS = [
  { id: 1, farmId: 1, userId: 1, cropSymbol: "MAIZE", cropName: "Maize", season: "WET_SEASON" as const,
    plantingDate: new Date("2025-04-15"), expectedHarvestDate: new Date("2025-08-30"),
    actualHarvestDate: null, plannedHectares: "20.0", actualHectares: null,
    expectedYieldMt: "60.0", actualYieldMt: null, inputCostNgn: "1800000",
    revenueNgn: null, notes: "Pioneer 30Y87 hybrid variety", createdAt: new Date(), updatedAt: new Date() },
  { id: 2, farmId: 1, userId: 1, cropSymbol: "SOYBEAN", cropName: "Soybean", season: "WET_SEASON" as const,
    plantingDate: new Date("2025-05-01"), expectedHarvestDate: new Date("2025-09-15"),
    actualHarvestDate: null, plannedHectares: "15.0", actualHectares: null,
    expectedYieldMt: "30.0", actualYieldMt: null, inputCostNgn: "1200000",
    revenueNgn: null, notes: "TGX 1835-10E variety", createdAt: new Date(), updatedAt: new Date() },
];

const DEMO_SOIL_TESTS = [
  { id: 1, farmId: 1, userId: 1, testDate: new Date("2025-03-01"), phLevel: "6.5",
    nitrogenPpm: "42.0", phosphorusPpm: "28.0", potassiumPpm: "185.0",
    organicMatterPct: "2.8", labName: "NASC Soil Lab Kano",
    recommendations: "Apply 200kg/ha NPK 15:15:15 at planting. Lime application not required. Organic matter is adequate.",
    reportUrl: null, createdAt: new Date() },
];

const DEMO_SUMMARY = {
  totalFarms: 2,
  totalHectares: 73.5,
  activePlans: 2,
  totalExpectedYieldMt: 90.0,
};
