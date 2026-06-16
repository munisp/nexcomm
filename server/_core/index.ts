import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import compression from "compression";
import { randomUUID } from "crypto";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStripeWebhook } from "../routers/stripeRouter";
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
import { suspiciousPatternDetector, ipBlocklistMiddleware, securityHeaders } from "../security";
import { ddosProtection, slowLorisGuard, tradingLimiter, transferLimiter, applyDDoSProtections } from "../ddos-protection";
import { ddosCircuitBreaker, bruteForceProtection, inputSanitization, additionalSecurityHeaders, sessionFixationPrevention, csrfProtection, csrfTokenEndpoint } from "../security-middleware";
import cookieParser from "cookie-parser";
import { policyStore } from "../pbac";
import { bootstrapPermify } from "../permify-bootstrap";
import { startTemporalWorker } from "../temporal/worker";

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

  // ── Trust proxy (required for rate-limiting behind reverse proxies / Manus gateway)
  // '1' means trust the first hop (the Manus edge proxy).
  app.set('trust proxy', 1);

  // ── Response compression (gzip/brotli) ──────────────────────────────────────
  // Applied before all other middleware to compress all responses > 1KB.
  // Excludes SSE streams and WebSocket upgrades.
  app.use(compression({
    level: 6, // balanced speed vs compression ratio
    threshold: 1024, // only compress responses > 1KB
    filter: (req, res) => {
      // Don't compress SSE streams or WebSocket upgrades
      if (req.headers.accept === 'text/event-stream') return false;
      return compression.filter(req, res);
    },
  }));

  // ── Security headers (Helmet with nonce-based CSP) ────────────────────────
  // P1-B: Replaced unsafe-inline/unsafe-eval with per-request nonces.
  // The nonce is generated per request and injected into the HTML via Vite.
  app.use((req, res, next) => {
    // Generate a cryptographically random nonce per request
    const nonce = randomUUID().replace(/-/g, '');
    res.locals.cspNonce = nonce;
    next();
  });

  app.use((req, res, next) => {
    const nonce = res.locals.cspNonce as string;
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Nonce-based script policy — eliminates unsafe-inline/unsafe-eval
          scriptSrc: [
            "'self'",
            `'nonce-${nonce}'`,
            "https://js.stripe.com",
            // Vite HMR in dev only
            ...(process.env.NODE_ENV !== 'production' ? ["'unsafe-eval'"] : []),
          ],
          styleSrc: ["'self'", `'nonce-${nonce}'`, "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          connectSrc: ["'self'", "wss:", "ws:", "https:"],
          frameSrc: ["https://js.stripe.com"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginEmbedderPolicy: false, // Required for Stripe.js
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    })(req, res, next);
  });

  // ── CORS policy ─────────────────────────────────────────────────────────────
  const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:5432")
    .split(",")
    .map(o => o.trim())
    .filter(Boolean);
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (same-origin, curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || origin.endsWith(".manus.space") || origin.endsWith(".manus.computer")) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Source", "X-Admin-Token", "X-Request-ID"],
    exposedHeaders: ["X-Request-ID"],
    maxAge: 86400,
  }));

  // ── Cookie parsing (required for CSRF double-submit cookie pattern) ────────
  app.use(cookieParser());
  // ── Additional security middleware ─────────────────────────────────────────
  applyDDoSProtections(app);             // DDoS: full protection suite (trading/transfer/upload limiters, velocity guards, bot detection)
  app.use(ddosProtection);               // DDoS: per-IP rate limiting + connection flood guard
  app.use(slowLorisGuard);               // Slow Loris: request body timeout enforcement
  app.use(ipBlocklistMiddleware);          // Block known abusive IPs
  app.use(suspiciousPatternDetector);      // Detect path traversal / SQLi probes
  app.use(securityHeaders);               // Extra security headers beyond Helmet
  app.use(ddosCircuitBreaker);             // Circuit breaker: 100 req/min per IP, 5-min block
  app.use(bruteForceProtection);           // Brute force: lockout after 10 failed auth attempts
  app.use(inputSanitization);              // Input sanitization: strip null bytes, XSS, path traversal
  app.use(additionalSecurityHeaders);      // Additional security headers: referrer policy, permissions
  app.use(sessionFixationPrevention);      // Session fixation: regenerate session on privilege escalation

  // ── Request ID correlation ────────────────────────────────────────────────
  // Assigns a UUID to every request for distributed tracing and log correlation.
  app.use((req, res, next) => {
    const requestId = (req.headers["x-request-id"] as string) || randomUUID();
    req.headers["x-request-id"] = requestId;
    res.setHeader("X-Request-ID", requestId);
    next();
  });

  // ── Rate limiting ──────────────────────────────────────────────────────────
  // General API rate limit: 300 requests per minute per IP
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
    skip: (req) => req.path === "/api/ha/status" || req.path === "/api/ha/status/metrics",
  });
  app.use("/api", apiLimiter);

  // Strict auth rate limit: 20 requests per 15 minutes per IP (prevents brute force)
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many authentication attempts, please try again later." },
  });
  app.use("/api/oauth", authLimiter);
  // Financial endpoint rate limits — applied before tRPC middleware to prevent order flooding
  // Trading: 60 orders/min per user; Transfer: 10 transfers/min per user
  app.use("/api/trpc/orders", tradingLimiter);
  app.use("/api/trpc/trading", tradingLimiter);
  app.use("/api/trpc/derivatives", tradingLimiter);
  app.use("/api/trpc/banking.transfer", transferLimiter);
  app.use("/api/trpc/banking.withdraw", transferLimiter);
  app.use("/api/trpc/banking.deposit", transferLimiter);
  app.use("/api/trpc/mojaloop", transferLimiter);
  // Stripe webhook MUST be registered before express.json() to preserve raw body for signature verification
  registerStripeWebhook(app);

  // Configure body parser — 10 MB is sufficient for JSON payloads; file uploads use multipart
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));

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
  // CSRF token endpoint — SPA calls this on boot to get a fresh token
  app.get("/api/csrf-token", csrfTokenEndpoint);
  // CSRF protection middleware — validates double-submit cookie on all state-changing requests
  app.use("/api/trpc", csrfProtection);
  // Deep health check endpoint — pings all 19 downstream microservices
  app.get("/api/health/deep", async (_req, res) => {
    try {
      const { deepHealthCheck } = await import("../security-middleware");
      const results = await deepHealthCheck();
      const statuses = Object.values(results);
      const allOk = statuses.every((s) => s.status === "ok");
      const anyDown = statuses.some((s) => s.status === "down");
      const httpStatus = allOk ? 200 : anyDown ? 503 : 207;
      res.status(httpStatus).json({
        status: allOk ? "ok" : anyDown ? "degraded" : "partial",
        services: results,
        summary: {
          total: statuses.length,
          ok: statuses.filter((s) => s.status === "ok").length,
          degraded: statuses.filter((s) => s.status === "degraded").length,
          down: statuses.filter((s) => s.status === "down").length,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ status: "error", error: String(err) });
    }
  });

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
  // Load PBAC policies persisted in the database (merges with in-memory defaults)
  void policyStore.loadFromDb();
  // Permify RBAC schema bootstrap: writes NEXCOM schema + seeds owner as exchange#admin.
  // Gracefully degrades if Permify is unreachable.
  bootstrapPermify().catch(err => console.warn("[Permify Bootstrap] Startup error:", err));
  startTemporalWorker().catch(err => console.warn("[Temporal] Startup error:", err));

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
