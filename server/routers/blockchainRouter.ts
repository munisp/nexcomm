/**
 * blockchainRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router proxying the Rust Blockchain Service (port 8004).
 * Handles commodity tokenization, fractional ownership, IPFS metadata,
 * on-chain settlement, and cross-chain bridge operations.
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, adminProcedure, router } from "../_core/trpc";
import { writeAuditLog } from "../audit";

const BC_URL = process.env.BLOCKCHAIN_SERVICE_URL ?? "http://localhost:8004";
const TIMEOUT_MS = 30000; // Blockchain operations can be slow

async function bcFetch(path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BC_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Blockchain service error: ${res.status} ${await res.text()}`);
  return res.json();
}

export const blockchainRouter = router({
  /** Health check */
  health: publicProcedure.query(async () => {
    try {
      const data = await bcFetch("/healthz");
      return { online: true, ...(data as object) };
    } catch {
      return { online: false };
    }
  }),

  /** Get chain status (all connected chains) */
  getChainStatus: publicProcedure.query(async () => {
    try {
      return await bcFetch("/api/v1/blockchain/chains/status");
    } catch {
      return { chains: [], error: "Blockchain service offline" };
    }
  }),

  /** Tokenize a commodity (create an on-chain token) */
  tokenizeCommodity: protectedProcedure
    .input(z.object({
      commodityId: z.string().trim(),
      commodityType: z.string().trim(),
      quantity: z.number().positive(),
      unit: z.string().trim(),
      warehouseReceiptId: z.string().optional(),
      gradeId: z.string().optional(),
      metadata: z.record(z.string().trim(), z.string().trim()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await bcFetch("/api/v1/blockchain/tokenize", {
          method: "POST",
          body: JSON.stringify({
            owner_id: String(ctx.user.id),
            commodity_id: input.commodityId,
            commodity_type: input.commodityType,
            quantity: input.quantity,
            unit: input.unit,
            warehouse_receipt_id: input.warehouseReceiptId,
            grade_id: input.gradeId,
            metadata: input.metadata ?? {},
          }),
        });
      } catch {
        return { error: "Blockchain service offline" };
      }
    }),

  /** List all tokens */
  listTokens: publicProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      try {
        return await bcFetch(`/api/v1/blockchain/tokens?page=${input.page}&limit=${input.limit}`);
      } catch {
        return { tokens: [], total: 0, error: "Blockchain service offline" };
      }
    }),

  /** Get a specific token */
  getToken: publicProcedure
    .input(z.object({ tokenId: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await bcFetch(`/api/v1/blockchain/tokens/${input.tokenId}`);
      } catch {
        return null;
      }
    }),

  /** Transfer a token to another account */
  transferToken: protectedProcedure
    .input(z.object({
      tokenId: z.string().trim(),
      toAccountId: z.string().trim(),
      quantity: z.number().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await bcFetch(`/api/v1/blockchain/tokens/${input.tokenId}/transfer`, {
          method: "POST",
          body: JSON.stringify({
            from_account_id: String(ctx.user.id),
            to_account_id: input.toAccountId,
            quantity: input.quantity,
          }),
        });
      } catch {
        return { error: "Blockchain service offline" };
      }
    }),

  /** Fractionalize a token for fractional ownership */
  fractionalizeToken: protectedProcedure
    .input(z.object({
      tokenId: z.string().trim(),
      totalFractions: z.number().int().positive(),
      pricePerFraction: z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await bcFetch(`/api/v1/blockchain/tokens/${input.tokenId}/fractionalize`, {
          method: "POST",
          body: JSON.stringify({
            owner_id: String(ctx.user.id),
            total_fractions: input.totalFractions,
            price_per_fraction: input.pricePerFraction,
          }),
        });
      } catch {
        return { error: "Blockchain service offline" };
      }
    }),

  /** Trigger on-chain settlement for a trade */
  onChainSettle: adminProcedure
    .input(z.object({
      tradeId: z.string().trim(),
      buyerId: z.string().trim(),
      sellerId: z.string().trim(),
      tokenId: z.string().trim(),
      quantity: z.number().positive(),
      price: z.number().positive(),
    }))
    .mutation(async ({ input }) => {
      try {
        return await bcFetch("/api/v1/blockchain/settle", {
          method: "POST",
          body: JSON.stringify(input),
        });
      } catch {
        return { error: "Blockchain service offline" };
      }
    }),

  /** Get a transaction by hash */
  getTransaction: publicProcedure
    .input(z.object({ txHash: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await bcFetch(`/api/v1/blockchain/tx/${input.txHash}`);
      } catch {
        return null;
      }
    }),

  /** List fractional assets */
  listFractionalAssets: publicProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      try {
        return await bcFetch(`/api/v1/blockchain/fractions/assets?page=${input.page}&limit=${input.limit}`);
      } catch {
        return { assets: [], total: 0, error: "Blockchain service offline" };
      }
    }),

  /** Get a fractional asset */
  getFractionalAsset: publicProcedure
    .input(z.object({ assetId: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await bcFetch(`/api/v1/blockchain/fractions/assets/${input.assetId}`);
      } catch {
        return null;
      }
    }),

  /** Submit a fractional order */
  submitFractionalOrder: protectedProcedure
    .input(z.object({
      assetId: z.string().trim(),
      side: z.enum(["BUY", "SELL"]),
      fractions: z.number().int().positive(),
      pricePerFraction: z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await bcFetch("/api/v1/blockchain/fractions/orders", {
          method: "POST",
          body: JSON.stringify({
            account_id: String(ctx.user.id),
            asset_id: input.assetId,
            side: input.side,
            fractions: input.fractions,
            price_per_fraction: input.pricePerFraction,
          }),
        });
      } catch {
        return { error: "Blockchain service offline" };
      }
    }),

  /** Get fractional order book for an asset */
  getFractionalOrderBook: publicProcedure
    .input(z.object({ assetId: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await bcFetch(`/api/v1/blockchain/fractions/orderbook/${input.assetId}`);
      } catch {
        return { bids: [], asks: [], error: "Blockchain service offline" };
      }
    }),

  /** Get fraction portfolio for the current user */
  getMyFractionPortfolio: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await bcFetch(`/api/v1/blockchain/fractions/portfolio/${ctx.user.id}`);
    } catch {
      return { holdings: [], error: "Blockchain service offline" };
    }
  }),

  /** Pin metadata to IPFS */
  ipfsPin: protectedProcedure
    .input(z.object({
      content: z.string().trim(),
      contentType: z.string().default("application/json"),
    }))
    .mutation(async ({ input }) => {
      try {
        return await bcFetch("/api/v1/blockchain/ipfs/pin", {
          method: "POST",
          body: JSON.stringify({ content: input.content, content_type: input.contentType }),
        });
      } catch {
        return { error: "Blockchain service offline" };
      }
    }),

  /** Get content from IPFS by CID */
  ipfsGet: publicProcedure
    .input(z.object({ cid: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await bcFetch(`/api/v1/blockchain/ipfs/get/${input.cid}`);
      } catch {
        return null;
      }
    }),

  /** Get IPFS node status */
  ipfsStatus: publicProcedure.query(async () => {
    try {
      return await bcFetch("/api/v1/blockchain/ipfs/status");
    } catch {
      return { online: false, error: "Blockchain service offline" };
    }
  }),

  /** Initiate a cross-chain bridge transfer */
  initiateBridge: protectedProcedure
    .input(z.object({
      tokenId: z.string().trim(),
      targetChain: z.string().trim(),
      targetAddress: z.string().trim(),
      quantity: z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await bcFetch("/api/v1/blockchain/bridge/initiate", {
          method: "POST",
          body: JSON.stringify({
            initiator_id: String(ctx.user.id),
            token_id: input.tokenId,
            target_chain: input.targetChain,
            target_address: input.targetAddress,
            quantity: input.quantity,
          }),
        });
      } catch {
        return { error: "Blockchain service offline" };
      }
    }),

  /** Get RPC configuration */
  getRpcConfig: adminProcedure.query(async () => {
    try {
      return await bcFetch("/api/v1/blockchain/rpc/config");
    } catch {
      return { error: "Blockchain service offline" };
    }
  }),

  /** Get current block number */
  getBlockNumber: publicProcedure.query(async () => {
    try {
      return await bcFetch("/api/v1/blockchain/rpc/block-number");
    } catch {
      return { block_number: 0, error: "Blockchain service offline" };
    }
  }),

  /** Get full on-chain provenance history for a token (Hyperledger GetHistory / EVM event log) */
  getTokenHistory: publicProcedure
    .input(z.object({ tokenId: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await bcFetch(`/api/v1/blockchain/tokens/${encodeURIComponent(input.tokenId)}/history`);
      } catch {
        return { history: [], error: "Blockchain service offline" };
      }
    }),

  /** Query all tokens owned by a specific account */
  getTokensByOwner: publicProcedure
    .input(z.object({ ownerId: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await bcFetch(`/api/v1/blockchain/tokens/owner/${encodeURIComponent(input.ownerId)}`);
      } catch {
        return { tokens: [], error: "Blockchain service offline" };
      }
    }),

  /** Search/filter tokens by commodity type, warehouse receipt, status, or chain */
  searchTokens: publicProcedure
    .input(z.object({
      commodityType: z.string().optional(),
      warehouseReceiptId: z.string().optional(),
      status: z.enum(["ACTIVE", "LOCKED", "FRACTIONALIZED", "REDEEMED"]).optional(),
      chain: z.string().optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      try {
        const params = new URLSearchParams();
        if (input.commodityType) params.set("commodity_type", input.commodityType);
        if (input.warehouseReceiptId) params.set("warehouse_receipt_id", input.warehouseReceiptId);
        if (input.status) params.set("status", input.status);
        if (input.chain) params.set("chain", input.chain);
        params.set("page", String(input.page));
        params.set("limit", String(input.limit));
        return await bcFetch(`/api/v1/blockchain/tokens/search?${params.toString()}`);
      } catch {
        return { tokens: [], total: 0, error: "Blockchain service offline" };
      }
    }),

  updateBlockchainRecord: protectedProcedure
    .input(z.object({ recordId: z.union([z.string(), z.number()]), data: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      await writeAuditLog(ctx.user.id, "blockchainRecord.update", { recordId: input.recordId });
      return { success: true };
    }),

  deleteBlockchainRecord: protectedProcedure
    .input(z.object({ recordId: z.union([z.string(), z.number()]) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      await writeAuditLog(ctx.user.id, "blockchainRecord.delete", { recordId: input.recordId });
      return { success: true };
    }),
});
