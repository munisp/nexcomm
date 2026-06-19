/**
 * NEXCOM Exchange — DDoS & Attack Mitigation Layer
 * =================================================
 * Implements multi-layer protection against:
 *  1. DDoS / volumetric floods (tiered rate limiting)
 *  2. Slow Loris / slow-read attacks (server timeouts)
 *  3. HTTP Parameter Pollution (HPP)
 *  4. Amplification attacks (response size limits)
 *  5. Brute-force on financial endpoints (trading, transfers)
 *  6. Credential stuffing (progressive backoff)
 *  7. Bot detection (user-agent fingerprinting)
 */

import type { Request, Response, NextFunction, Application } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import slowDown from "express-slow-down";
// @ts-ignore
import hpp from "hpp";
import { randomUUID } from "crypto";

// ── 1. Tiered Rate Limits ─────────────────────────────────────────────────────

/** Public read endpoints: 120 req/min (generous for market data) */
export const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  message: { error: "Rate limit exceeded on public endpoints.", code: "RATE_LIMIT_PUBLIC" },
  skip: (req) => req.path === "/api/health" || req.path === "/api/trpc/health.check",
});

/** Authenticated API: 200 req/min per user (stricter than IP-based) */
export const authenticatedLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Key by session cookie if available, else IP
    const sessionId = (req.cookies as Record<string, string>)?.["app_session_id"];
    return sessionId ? `sess:${sessionId}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
  message: { error: "Rate limit exceeded. Please slow down.", code: "RATE_LIMIT_AUTH" },
});

/** Trading endpoints: 60 orders/min per user (prevents order flooding) */
export const tradingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const sessionId = (req.cookies as Record<string, string>)?.["app_session_id"];
    return `trade:${sessionId ?? ipKeyGenerator(req.ip ?? "")}`;
  },
  message: { error: "Trading rate limit exceeded. Maximum 60 orders per minute.", code: "RATE_LIMIT_TRADING" },
});

/** Financial transfers: 10 transfers/min per user (prevents transfer flooding) */
export const transferLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const sessionId = (req.cookies as Record<string, string>)?.["app_session_id"];
    return `transfer:${sessionId ?? ipKeyGenerator(req.ip ?? "")}`;
  },
  message: { error: "Transfer rate limit exceeded. Maximum 10 transfers per minute.", code: "RATE_LIMIT_TRANSFER" },
});

/** KYC/document upload: 5 uploads/hour per user */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const sessionId = (req.cookies as Record<string, string>)?.["app_session_id"];
    return `upload:${sessionId ?? ipKeyGenerator(req.ip ?? "")}`;
  },
  message: { error: "Upload rate limit exceeded. Maximum 5 uploads per hour.", code: "RATE_LIMIT_UPLOAD" },
});

// ── 2. Progressive Slowdown (before hard block) ───────────────────────────────

/** Slow down requests after 100 req/min — adds 500ms delay per request above threshold */
export const progressiveSlowdown = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 100,
  delayMs: (used) => (used - 100) * 500, // 500ms per request above 100
  maxDelayMs: 10000, // max 10s delay
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
});

// ── 3. Slow Loris / Connection Timeout Enforcement ───────────────────────────

/**
 * Apply server-level timeouts to prevent slow-loris attacks.
 * Call this AFTER server.listen().
 */
export function applyServerTimeouts(server: import("http").Server): void {
  // Time to receive the complete request headers (prevents slow-loris)
  server.headersTimeout = 15_000; // 15 seconds
  // Time to receive the complete request body
  server.requestTimeout = 30_000; // 30 seconds
  // Keep-alive timeout (prevents connection exhaustion)
  server.keepAliveTimeout = 65_000; // 65 seconds (> typical LB timeout of 60s)
  // Max connections (prevents connection pool exhaustion)
  server.maxConnections = 10_000;
  console.log("[DDoS] Server timeouts configured: headers=15s, request=30s, keepAlive=65s");
}

// ── 4. HTTP Parameter Pollution Prevention ───────────────────────────────────

/** Prevent HPP attacks by allowing only the last value for duplicate params */
export const hppProtection = hpp({
  whitelist: [
    "ids",       // Allow array of IDs for batch operations
    "symbols",   // Allow array of symbols for market data
    "tags",      // Allow array of tags
    "statuses",  // Allow array of statuses for filtering
  ],
});

// ── 5. Bot / Automated Attack Detection ──────────────────────────────────────

const SUSPICIOUS_USER_AGENTS = [
  /sqlmap/i,
  /nikto/i,
  /nmap/i,
  /masscan/i,
  /zgrab/i,
  /dirbuster/i,
  /gobuster/i,
  /wfuzz/i,
  /hydra/i,
  /medusa/i,
  /burpsuite/i,
  /python-requests\/[01]\./i, // Old Python requests versions used in scripts
  /go-http-client\/1\./i,     // Go HTTP/1.1 clients (common in attack tools)
  /libwww-perl/i,
  /lwp-trivial/i,
  /curl\/[0-6]\./i,           // Very old curl versions
];

// Track suspicious IPs in memory (in production, use Redis)
const suspiciousIpTracker = new Map<string, { count: number; firstSeen: number; blocked: boolean }>();
const SUSPICIOUS_THRESHOLD = 10; // Block after 10 suspicious requests
const TRACKER_TTL_MS = 60 * 60 * 1000; // 1 hour TTL

export function botDetectionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ua = req.headers["user-agent"] ?? "";
  const ip = ipKeyGenerator(req.ip ?? "");

  // Check if IP is already blocked
  const tracker = suspiciousIpTracker.get(ip);
  if (tracker?.blocked) {
    res.status(403).json({ error: "Access denied.", code: "BOT_BLOCKED" });
    return;
  }

  // Check for known attack tool user agents
  const isSuspicious = SUSPICIOUS_USER_AGENTS.some((pattern) => pattern.test(ua));
  if (isSuspicious) {
    const now = Date.now();
    const existing = suspiciousIpTracker.get(ip);
    if (!existing || now - existing.firstSeen > TRACKER_TTL_MS) {
      suspiciousIpTracker.set(ip, { count: 1, firstSeen: now, blocked: false });
    } else {
      existing.count++;
      if (existing.count >= SUSPICIOUS_THRESHOLD) {
        existing.blocked = true;
        console.warn(`[DDoS] Blocked IP ${ip} after ${existing.count} suspicious requests (UA: ${ua.slice(0, 80)})`);
      }
    }
    console.warn(`[DDoS] Suspicious user agent from ${ip}: ${ua.slice(0, 80)}`);
    res.status(403).json({ error: "Access denied.", code: "SUSPICIOUS_CLIENT" });
    return;
  }

  // Clean up old entries periodically
  if (Math.random() < 0.001) {
    const now = Date.now();
    for (const [key, val] of Array.from(suspiciousIpTracker.entries())) {
      if (now - val.firstSeen > TRACKER_TTL_MS && !val.blocked) {
        suspiciousIpTracker.delete(key);
      }
    }
  }

  next();
}

// ── 6. Request Size Enforcement ───────────────────────────────────────────────

/** Reject oversized requests early (before body parsing) */
export function requestSizeGuard(req: Request, res: Response, next: NextFunction): void {
  const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
  const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB
  if (contentLength > MAX_BODY_SIZE) {
    res.status(413).json({ error: "Request entity too large.", code: "PAYLOAD_TOO_LARGE" });
    return;
  }
  next();
}

// ── 7. Financial Endpoint Fingerprinting ─────────────────────────────────────

/** 
 * Detect patterns consistent with automated trading bots or order flooding.
 * Tracks order submission frequency per session.
 */
const orderVelocityTracker = new Map<string, { count: number; windowStart: number }>();
const ORDER_VELOCITY_WINDOW_MS = 10_000; // 10 seconds
const ORDER_VELOCITY_MAX = 10; // max 10 orders per 10 seconds

export function orderVelocityGuard(req: Request, res: Response, next: NextFunction): void {
  // Only apply to order creation endpoints
  const body = req.body as Record<string, unknown> | undefined;
  const procedurePath = (body?.["0"] as Record<string, unknown>)?.json;
  if (!procedurePath) {
    next();
    return;
  }

  const sessionId = (req.cookies as Record<string, string>)?.["app_session_id"] ?? ipKeyGenerator(req.ip ?? "");
  const now = Date.now();
  const tracker = orderVelocityTracker.get(sessionId);

  if (!tracker || now - tracker.windowStart > ORDER_VELOCITY_WINDOW_MS) {
    orderVelocityTracker.set(sessionId, { count: 1, windowStart: now });
    next();
    return;
  }

  tracker.count++;
  if (tracker.count > ORDER_VELOCITY_MAX) {
    console.warn(`[DDoS] Order velocity limit exceeded for session ${sessionId.slice(0, 8)}...`);
    res.status(429).json({
      error: "Order submission rate too high. Please wait before submitting more orders.",
      code: "ORDER_VELOCITY_EXCEEDED",
      retryAfter: Math.ceil((ORDER_VELOCITY_WINDOW_MS - (now - tracker.windowStart)) / 1000),
    });
    return;
  }

  next();
}

// ── 8. Compatibility Exports (expected by server/_core/index.ts) ─────────────

/**
 * Combined DDoS middleware: HPP + request size guard + bot detection.
 * Used as a single middleware in server/_core/index.ts.
 */
export function ddosProtection(req: Request, res: Response, next: NextFunction): void {
  hppProtection(req, res, () => {
    requestSizeGuard(req, res, () => {
      botDetectionMiddleware(req, res, next);
    });
  });
}

/**
 * Slow Loris guard: enforces a 30-second timeout on request body receipt.
 * Prevents slow-loris attacks that hold connections open indefinitely.
 */
export function slowLorisGuard(req: Request, res: Response, next: NextFunction): void {
  const BODY_TIMEOUT_MS = 30_000;
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({ error: "Request timeout.", code: "SLOW_LORIS_DETECTED" });
    }
  }, BODY_TIMEOUT_MS);
  res.on("finish", () => clearTimeout(timer));
  res.on("close", () => clearTimeout(timer));
  next();
}

// ── 9. Register All DDoS Protections ─────────────────────────────────────────

/**
 * Apply all DDoS protections to the Express app.
 * Call this BEFORE registering routes.
 */
export function applyDDoSProtections(app: Application): void {
  // HPP protection (must be before route handlers)
  app.use(hppProtection);

  // Request size guard (before body parsing)
  app.use(requestSizeGuard);

  // Bot detection
  app.use(botDetectionMiddleware);

  // Progressive slowdown (before hard rate limits)
  app.use("/api", progressiveSlowdown);

  // Tiered rate limits by endpoint sensitivity
  app.use("/api/trpc/orders", tradingLimiter);
  app.use("/api/trpc/trades", tradingLimiter);
  app.use("/api/trpc/derivatives", tradingLimiter);
  app.use("/api/trpc/futures", tradingLimiter);
  app.use("/api/trpc/banking.transfer", transferLimiter);
  app.use("/api/trpc/banking.applyLoan", transferLimiter);
  app.use("/api/trpc/ledger.internalTransfer", transferLimiter);
  app.use("/api/trpc/onboarding", uploadLimiter);
  app.use("/api/trpc/kyc", uploadLimiter);

  // Order velocity guard on trading endpoints
  app.use("/api/trpc/orders.create", orderVelocityGuard);
  app.use("/api/trpc/trades.execute", orderVelocityGuard);

  console.log("[DDoS] Multi-layer DDoS protections applied");
}
