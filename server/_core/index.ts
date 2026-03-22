import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { attachOrderBookWS } from "../ws/orderBookServer";
import { startAlertPollingJob } from "../routers/priceAlerts";
import { startGrpcServer } from "../grpc/server";
import { startAllEngines, stopAllEngines } from "../engineHAManager";
import { runDailySnapshotJob, backfillAllSnapshots } from "../jobs/portfolioSnapshotJob";
import { startSettlementJob } from "../jobs/settlementJob";
import { startSettlementCycleJob } from "../jobs/settlementCycleJob";
import { startMarginAlertJob } from "../jobs/marginAlertJob";
import { startLiquidationJob } from "../jobs/liquidationJob";
import { startMarketMakerJob } from "../jobs/marketMakerJob";
import { startSurveillanceDigestJob } from "../jobs/surveillanceDigestJob";
import { startMarkToMarketJob } from "../jobs/markToMarketJob";
import { startExpiryNotificationJob } from "../jobs/expiryNotificationJob";
import { startReKycScheduler } from "../jobs/reKycScheduler";
import { startPriceFeedJob } from "../jobs/priceFeedJob";
import { registerCooperativeExportRoute } from "../routes/cooperativeExport";
import { registerDisputeEvidenceUploadRoute } from "../routes/disputeEvidenceUpload";
import { registerFarmerKycUploadRoute } from "../routes/farmerKycUpload";
import { mojaloopSettlementCallbackRouter } from "../routes/mojaloopSettlementCallback";
import { startKafkaConsumer, stopKafkaConsumer } from "../kafka/kafkaConsumer";
import { disconnectKafkaProducer } from "../kafka/kafkaProducer";
import { startMojaloopHubHealthJob } from "../jobs/mojaloopHubHealthJob";
import { spatialProxyRouter } from "../routes/spatialProxy";
import { haStatusRouter } from "../routes/haStatusRoute";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // Cooperative member CSV export (admin-only)
  registerCooperativeExportRoute(app);

  // Dispute evidence file upload (authenticated)
  registerDisputeEvidenceUploadRoute(app);

  // Farmer KYC document upload (authenticated, 10 MB max, PDF/JPEG/PNG/WEBP)
  registerFarmerKycUploadRoute(app);

  // Internal Mojaloop settlement callback (called by Go mojaloop-adapter on COMMITTED transfers)
  // Endpoint: POST /api/internal/mojaloop/settlement-callback
  // Protected by X-Source: mojaloop-adapter header
  app.use(mojaloopSettlementCallbackRouter);

  // Spatial analytics proxy — forwards /api/spatial/* to Sedona Python service (port 7474)
  app.use(spatialProxyRouter);

  // HA status REST endpoint — /api/ha/status, /api/ha/status/metrics, /api/ha/status/engines
  app.use(haStatusRouter);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // Attach WebSocket order book feed
  attachOrderBookWS(server);

  // Start price alert polling job (checks every 30s)
  startAlertPollingJob();

  // ── Portfolio snapshot daily cron ─────────────────────────────────────────
  // Backfill 30 days of history on startup (no-ops if rows already exist),
  // then schedule a daily job at midnight UTC to capture end-of-day values.
  backfillAllSnapshots(30).catch(console.error);
  const MIDNIGHT_MS = 24 * 60 * 60 * 1000;
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setUTCHours(24, 0, 0, 0);
  const msUntilMidnight = nextMidnight.getTime() - now.getTime();
  setTimeout(() => {
    runDailySnapshotJob().catch(console.error);
    setInterval(() => runDailySnapshotJob().catch(console.error), MIDNIGHT_MS);
  }, msUntilMidnight);

  // ── Settlement auto-processing job ─────────────────────────────────────────
  // Runs every 5 minutes; advances PENDING settlements past their T+2 date to SETTLED.
  startSettlementJob();

  // ── Settlement cycle automation job ──────────────────────────────────────
  // Creates T+1 cycles at market close (15:00 UTC), runs DVP matching, escalates stale cycles.
  startSettlementCycleJob();

  // ── Margin call alert job ─────────────────────────────────────────────────
  // Runs every 5 minutes; fires WARNING (≥80%) and CRITICAL (≥95%) notifications.
  startMarginAlertJob();

  // ── Forced liquidation job ────────────────────────────────────────────────
  // Runs every 5 minutes; cancels open orders and liquidates collateral when
  // margin utilisation reaches or exceeds 100%.
  startLiquidationJob();

  // ── Market Maker daily performance job ──────────────────────────────────────
  // Runs daily at 16:00 UTC (17:00 WAT); auto-generates performance reports,
  // sends low-uptime alerts, and auto-suspends persistent violators.
  startMarketMakerJob();

  // ── Daily Surveillance Digest ─────────────────────────────────────────────
  // Runs at 08:00 WAT (07:00 UTC) to notify the owner of circuit breaker events,
  // active halts, and pending wash-trade flags from the previous day.
  startSurveillanceDigestJob();

  // ── Daily Mark-to-Market Settlement ──────────────────────────────────────
  // Runs at 16:00 WAT (15:00 UTC); uses last traded price from the order book
  // to settle all active futures contracts, update position P&L, and credit/debit
  // clearing accounts. Sends owner notification with daily P&L summary.
  startMarkToMarketJob();

  // ── Expiry Notification Job ──────────────────────────────────────────────
  // Runs daily at 09:00 WAT (08:00 UTC); identifies futures and options contracts
  // expiring within 3 days and sends the owner a notification with open position counts.
  startExpiryNotificationJob();

  // ── Periodic Re-KYC Scheduler ──────────────────────────────────────────────
  // Runs daily at 07:00 UTC; flags approved stakeholders whose KYC is older than
  // 12 months and high-volume traders/farmers with ≥2 active listings.
  startReKycScheduler();

  // ── Live Price Feed Job ───────────────────────────────────────────────────
  // Polls Yahoo Finance every 5 minutes for live commodity futures prices
  // (Gold, Crude Oil, Wheat, Cocoa, Coffee, Sugar, Cotton, Soybean, Copper, Silver, Corn).
  // Upserts prices into the live_prices table for Markets and Indices pages.
  startPriceFeedJob();

  // ── Mojaloop Hub Health Polling Job ──────────────────────────────────────
  // Polls the Go mojaloop-adapter /health endpoint every 5 minutes.
  // Sends owner notification if the hub transitions ONLINE→OFFLINE or OFFLINE→ONLINE.
  const stopMojaloopHealthJob = startMojaloopHubHealthJob();

  // ── gRPC inter-service communication layer (TypeScript fallback) ────────────
  // The TypeScript gRPC server handles PriceAlertService streaming.
  // MatchingEngine and SettlementService are now handled by the Rust binary.
  const grpcPort = parseInt(process.env.GRPC_PORT || "50051");
  startGrpcServer(grpcPort);

  // ── Kafka Event Streaming ───────────────────────────────────────────────
  // Connects to Kafka brokers and subscribes to order.filled, settlement.completed,
  // order.cancelled, price.updated, and risk.alert topics.
  // Gracefully degrades if Kafka is unavailable (KAFKA_BROKERS env var).
  startKafkaConsumer().catch(console.error);

  // ── Native Engine Startup ─────────────────────────────────────────────────
  // Spawns both the Rust matching engine (port 8080) and the Go gateway service
  // (port 8200, wraps TigerBeetle ledger + Kafka + Redis + Temporal).
  // Both fall back gracefully if their binaries are not present.
  await startAllEngines();

  // Graceful shutdown: stop all native engines when Node process exits
  process.on("SIGTERM", async () => { stopAllEngines(); stopMojaloopHealthJob(); await stopKafkaConsumer(); await disconnectKafkaProducer(); process.exit(0); });
  process.on("SIGINT",  async () => { stopAllEngines(); stopMojaloopHealthJob(); await stopKafkaConsumer(); await disconnectKafkaProducer(); process.exit(0); });

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
