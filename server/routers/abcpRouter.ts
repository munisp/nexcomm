import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { abcpPrograms } from "../../drizzle/schema";
import { eq, desc, count, sum, avg } from "drizzle-orm";

export const abcpRouter = router({
  list: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return DEMO_PROGRAMS;
    try {
      const rows = await db.select().from(abcpPrograms)
        .orderBy(desc(abcpPrograms.createdAt)).limit(50);
      return rows.length > 0 ? rows : DEMO_PROGRAMS;
    } catch { return DEMO_PROGRAMS; }
  }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return DEMO_PROGRAMS.find(p => p.id === input.id) ?? null;
      try {
        const rows = await db.select().from(abcpPrograms)
          .where(eq(abcpPrograms.id, input.id)).limit(1);
        return rows[0] ?? null;
      } catch { return null; }
    }),

  create: protectedProcedure
    .input(z.object({
      programName: z.string().min(5),
      sponsorName: z.string().trim(),
      arrangerName: z.string().optional(),
      programSizeNgn: z.string().trim(),
      collateralType: z.string().trim(),
      collateralValueNgn: z.string().optional(),
      yieldPct: z.string().optional(),
      tenorDays: z.number(),
      creditRating: z.string().optional(),
      ratingAgency: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [prog] = await db.insert(abcpPrograms).values({
        ...input,
        sponsorUserId: ctx.user.id,
        status: "STRUCTURING",
      }).returning();
      return { success: true, programId: prog.id };
    }),

  stats: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalPrograms: 0, totalIssuanceNgn: 0, outstandingNgn: 0, avgYieldPct: 0, avgCoverageRatioPct: 0 };
    const [row] = await db
      .select({
        totalPrograms: count(),
        totalIssuanceNgn: sum(abcpPrograms.programSizeNgn),
        outstandingNgn: sum(abcpPrograms.outstandingNgn),
        avgYieldPct: avg(abcpPrograms.yieldPct),
        avgCoverageRatioPct: avg(abcpPrograms.coverageRatioPct),
      })
      .from(abcpPrograms);
    return {
      totalPrograms: Number(row?.totalPrograms ?? 0),
      totalIssuanceNgn: Number(row?.totalIssuanceNgn ?? 0),
      outstandingNgn: Number(row?.outstandingNgn ?? 0),
      avgYieldPct: Number(Number(row?.avgYieldPct ?? 0).toFixed(2)),
      avgCoverageRatioPct: Number(Number(row?.avgCoverageRatioPct ?? 0).toFixed(2)),
    };
  }),
});

const DEMO_PROGRAMS = [
  {
    id: 1, programName: "NEXCOM Agri ABCP Series 1 — Grains",
    isin: "NG0003751234", sponsorName: "NEXCOM Capital Markets",
    sponsorUserId: null, arrangerName: "Stanbic IBTC",
    programSizeNgn: "25000000000", outstandingNgn: "22000000000",
    collateralType: "WAREHOUSE_RECEIPTS", collateralValueNgn: "31350000000",
    coverageRatioPct: "142.50", yieldPct: "14.7500", tenorDays: 180,
    issueDate: new Date("2025-06-01"), maturityDate: new Date("2025-11-28"),
    creditRating: "A-", ratingAgency: "Agusto & Co",
    status: "TRADING" as const, secApprovalRef: "SEC/ABCP/2025/001",
    prospectusUrl: null, underlyingEwrIds: [1, 2, 3, 4, 5],
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 2, programName: "NEXCOM Oilseeds ABCP Series 2",
    isin: "NG0003751235", sponsorName: "NEXCOM Capital Markets",
    sponsorUserId: null, arrangerName: "Access Bank",
    programSizeNgn: "15000000000", outstandingNgn: "14000000000",
    collateralType: "WAREHOUSE_RECEIPTS", collateralValueNgn: "19600000000",
    coverageRatioPct: "140.00", yieldPct: "15.2500", tenorDays: 90,
    issueDate: new Date("2025-09-01"), maturityDate: new Date("2025-11-30"),
    creditRating: "A", ratingAgency: "GCR",
    status: "TRADING" as const, secApprovalRef: "SEC/ABCP/2025/002",
    prospectusUrl: null, underlyingEwrIds: [6, 7, 8],
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 3, programName: "NEXCOM Green Agri Bond 2026",
    isin: "NG0001234567", sponsorName: "NEXCOM Exchange",
    sponsorUserId: null, arrangerName: "GTBank",
    programSizeNgn: "10000000000", outstandingNgn: "9500000000",
    collateralType: "AGRI_COMMODITY_RECEIPTS", collateralValueNgn: "13300000000",
    coverageRatioPct: "140.00", yieldPct: "13.0000", tenorDays: 365,
    issueDate: new Date("2024-09-30"), maturityDate: new Date("2026-09-30"),
    creditRating: "BBB+", ratingAgency: "GCR",
    status: "TRADING" as const, secApprovalRef: "SEC/BOND/2024/045",
    prospectusUrl: null, underlyingEwrIds: [],
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 4, programName: "NEXCOM Spice & Horticulture ABCP Series 3",
    isin: null, sponsorName: "NEXCOM Capital Markets",
    sponsorUserId: null, arrangerName: "Zenith Bank",
    programSizeNgn: "37500000000", outstandingNgn: "26500000000",
    collateralType: "WAREHOUSE_RECEIPTS", collateralValueNgn: null,
    coverageRatioPct: null, yieldPct: "14.5000", tenorDays: 270,
    issueDate: null, maturityDate: null,
    creditRating: null, ratingAgency: null,
    status: "SEC_REVIEW" as const, secApprovalRef: null,
    prospectusUrl: null, underlyingEwrIds: [],
    createdAt: new Date(), updatedAt: new Date(),
  },
];
