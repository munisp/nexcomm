import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getGatewayHealth, getMiddlewareStatus } from "../gatewayClient";
import { checkMatchingEngineHealth, checkSettlementEngineHealth, getExchangeStatus } from "../matchingEngineClient";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  /**
   * Platform health aggregator — returns the live status of all native services:
   *   - Rust matching engine (port 8080)
   *   - Rust settlement engine (port 8005)
   *   - Go gateway service (port 8200)
   *   - TigerBeetle ledger (via gateway)
   *   - Kafka, Redis, Temporal, Dapr, Fluvio, Keycloak, Permify (via gateway)
   */
  platformHealth: adminProcedure.query(async () => {
    // Run all health checks in parallel
    const [meHealthy, settlementHealthy, gatewayHealth, middlewareStatus, exchangeStatus] =
      await Promise.allSettled([
        checkMatchingEngineHealth(),
        checkSettlementEngineHealth(),
        getGatewayHealth(),
        getMiddlewareStatus(),
        getExchangeStatus(),
      ]);

    const me = meHealthy.status === "fulfilled" ? meHealthy.value : false;
    const settlement = settlementHealthy.status === "fulfilled" ? settlementHealthy.value : false;
    const gateway = gatewayHealth.status === "fulfilled" ? gatewayHealth.value : null;
    const middleware = middlewareStatus.status === "fulfilled" ? middlewareStatus.value : null;
    const exchange = exchangeStatus.status === "fulfilled" ? exchangeStatus.value : null;

    return {
      services: {
        matchingEngine: {
          name: "Rust Matching Engine",
          status: me ? "online" : "offline",
          port: 8080,
          description: "Price-time priority order book, partial fills, IOC/FOK, circuit breaker",
        },
        settlementEngine: {
          name: "Rust Settlement Engine",
          status: settlement ? "online" : "offline",
          port: 8005,
          description: "T+2 settlement lifecycle, DVP matching, counterparty netting",
        },
        gateway: {
          name: "Go Gateway Service",
          status: gateway ? "online" : "offline",
          port: 8200,
          version: gateway?.version ?? null,
          uptime: gateway?.uptime ?? null,
          description: "TigerBeetle ledger, Kafka, Redis, Temporal, Keycloak, Permify",
        },
      },
      middleware: gateway
        ? {
            tigerbeetle: { connected: gateway.middleware.tigerbeetle, description: "Double-entry accounting ledger" },
            kafka: { connected: gateway.middleware.kafka, description: "Event streaming" },
            redis: { connected: gateway.middleware.redis, description: "Cache & session store" },
            temporal: { connected: gateway.middleware.temporal, description: "Workflow orchestration" },
            dapr: { connected: gateway.middleware.dapr, description: "Distributed application runtime" },
            fluvio: { connected: gateway.middleware.fluvio, description: "Real-time data streaming" },
          }
        : null,
      middlewareDetail: middleware,
      exchangeStatus: exchange,
    };
  }),
});
