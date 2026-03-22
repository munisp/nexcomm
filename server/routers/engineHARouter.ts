/**
 * engineHARouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router exposing engine HA health status and KEDA/Kafka config to the
 * admin dashboard.
 *
 * Procedures:
 *   engineHA.getStatus        — returns all engine snapshots (admin only)
 *   engineHA.getOverall       — lightweight public "all healthy?" boolean
 *   engineHA.getKedaConfig    — returns KEDA/Kafka wiring status + bootstrap cmds (admin)
 *   engineHA.updateKedaConfig — stores KAFKA_BROKERS + REDIS_URL in runtime env (admin)
 */

import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { haManager, type EngineHealthSnapshot, type EngineStatus } from "../engineHAManager";
import { ENV } from "../_core/env";
import { TRPCError } from "@trpc/server";

// ── Zod schemas for serialisation ────────────────────────────────────────────

const engineStatusSchema = z.enum([
  "STARTING",
  "HEALTHY",
  "DEGRADED",
  "UNAVAILABLE",
  "CIRCUIT_OPEN",
  "STOPPED",
]);

const engineSnapshotSchema = z.object({
  name: z.string(),
  status: engineStatusSchema,
  pid: z.number().nullable(),
  port: z.number(),
  restartCount: z.number(),
  lastHealthyAt: z.date().nullable(),
  lastErrorAt: z.date().nullable(),
  circuitOpenUntil: z.date().nullable(),
  uptimeMs: z.number().nullable(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAdminUser(ctx: { user: { role: string } }) {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
}

/**
 * Build the kubectl commands an operator needs to run once to wire KEDA to a
 * real Kafka cluster.  These are returned as strings so the admin UI can
 * display them in a copy-paste panel.
 */
function buildKedaBootstrapCommands(
  brokers: string,
  saslUser: string,
  saslPass: string,
  redisAddr: string,
  redisPass: string,
  namespace: string,
): string[] {
  return [
    `# 1. Create the Kafka credentials secret`,
    `kubectl create secret generic nexcom-kafka-credentials \\`,
    `  --from-literal=bootstrapServers="${brokers}" \\`,
    `  --from-literal=saslUsername="${saslUser}" \\`,
    `  --from-literal=saslPassword="${saslPass}" \\`,
    `  -n ${namespace} --dry-run=client -o yaml | kubectl apply -f -`,
    ``,
    `# 2. Create the Redis credentials secret`,
    `kubectl create secret generic nexcom-redis-credentials \\`,
    `  --from-literal=address="${redisAddr}" \\`,
    `  --from-literal=password="${redisPass}" \\`,
    `  -n ${namespace} --dry-run=client -o yaml | kubectl apply -f -`,
    ``,
    `# 3. Apply KEDA TriggerAuthentication manifests`,
    `kubectl apply -f infra/ha/keda/keda-trigger-auth.yaml`,
    ``,
    `# 4. Apply KEDA ScaledObjects`,
    `kubectl apply -f infra/ha/keda/scaled-objects.yaml`,
    ``,
    `# 5. Verify ScaledObjects are active`,
    `kubectl get scaledobjects -n ${namespace}`,
  ];
}

// ── Router ────────────────────────────────────────────────────────────────────

export const engineHARouter = router({
  /**
   * getStatus — returns the full HA snapshot for all engines.
   * Admin-only: only users with role=admin may call this.
   */
  getStatus: protectedProcedure.query(({ ctx }) => {
    isAdminUser(ctx);
    const snapshots = haManager.getHealth();
    return snapshots.map(s => ({
      ...s,
      lastHealthyAt: s.lastHealthyAt ?? null,
      lastErrorAt: s.lastErrorAt ?? null,
      circuitOpenUntil: s.circuitOpenUntil ?? null,
    }));
  }),

  /**
   * getOverall — lightweight public endpoint for the header status indicator.
   */
  getOverall: publicProcedure.query(() => {
    const snapshots = haManager.getHealth();
    const critical = ["MatchingEngine", "SettlementEngine"];
    const allHealthy = critical.every(name => {
      const snap = snapshots.find(s => s.name === name);
      return snap?.status === "HEALTHY" || snap?.status === "DEGRADED";
    });

    const summary = snapshots.map(s => ({
      name: s.name,
      status: s.status,
      restartCount: s.restartCount,
    }));

    return {
      allHealthy,
      summary,
      checkedAt: new Date(),
    };
  }),

  /**
   * getKedaConfig — returns current KAFKA_BROKERS / REDIS_URL wiring status
   * plus the kubectl bootstrap commands the operator needs to run.
   * Admin-only.
   */
  getKedaConfig: protectedProcedure.query(({ ctx }) => {
    isAdminUser(ctx);

    const kafkaBrokers = ENV.kafkaBrokers;
    const redisUrl = ENV.redisUrl;
    const namespace = ENV.kedaNamespace;

    const isKafkaReal = kafkaBrokers !== "localhost:9092";
    const isRedisReal = redisUrl !== "redis://localhost:6379";

    // Parse redis address from URL (redis://:pass@host:port or redis://host:port)
    let redisAddr = "localhost:6379";
    let redisPass = "";
    try {
      const u = new URL(redisUrl);
      redisAddr = `${u.hostname}:${u.port || 6379}`;
      redisPass = u.password ?? "";
    } catch {
      redisAddr = redisUrl;
    }

    const bootstrapCommands = buildKedaBootstrapCommands(
      kafkaBrokers,
      "nexcom",
      "<SASL_PASSWORD>",
      redisAddr,
      redisPass,
      namespace,
    );

    return {
      kafkaBrokers,
      redisUrl,
      namespace,
      isKafkaReal,
      isRedisReal,
      kedaReady: isKafkaReal && isRedisReal,
      bootstrapCommands,
      checkedAt: new Date(),
    };
  }),

  /**
   * updateKedaConfig — updates KAFKA_BROKERS and REDIS_URL at runtime so the
   * running server immediately uses the new values without a restart.
   * The operator must also run the kubectl commands (returned by getKedaConfig)
   * to update the Kubernetes secrets used by KEDA.
   * Admin-only.
   */
  updateKedaConfig: protectedProcedure
    .input(
      z.object({
        kafkaBrokers: z.string().min(1).describe("Comma-separated broker list, e.g. broker1:9092,broker2:9092"),
        redisUrl: z.string().min(1).describe("Redis URL, e.g. redis://:password@host:6379"),
        kedaNamespace: z.string().optional().default("nexcom"),
      }),
    )
    .mutation(({ ctx, input }) => {
      isAdminUser(ctx);

      // Update process.env so all subsequent Kafka/Redis clients pick up the new values
      process.env.KAFKA_BROKERS = input.kafkaBrokers;
      process.env.REDIS_URL = input.redisUrl;
      process.env.KEDA_NAMESPACE = input.kedaNamespace;

      // Also update the ENV singleton (for getKedaConfig to reflect immediately)
      (ENV as unknown as Record<string, string>).kafkaBrokers = input.kafkaBrokers;
      (ENV as unknown as Record<string, string>).redisUrl = input.redisUrl;
      (ENV as unknown as Record<string, string>).kedaNamespace = input.kedaNamespace;

      console.log(`[KEDA] Config updated — Kafka: ${input.kafkaBrokers}, Redis: ${input.redisUrl}`);

      return {
        success: true,
        message: "KEDA config updated in runtime. Run the kubectl bootstrap commands to update Kubernetes secrets.",
        updatedAt: new Date(),
      };
    }),
});
