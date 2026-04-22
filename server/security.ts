/**
 * NEXCOM Exchange — Security Hardening Middleware
 * ================================================
 * Centralised security utilities applied at the Express layer.
 *
 * Includes:
 *  1. Input sanitization helper (XSS strip)
 *  2. Request ID injection (for audit trails)
 *  3. Security-event logger
 *  4. Suspicious pattern detector (path traversal, SQL injection probes)
 *  5. Content-type enforcement on mutation endpoints
 */
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

// ── 1. Request ID Middleware ──────────────────────────────────────────────────
export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers["x-request-id"] as string) || randomUUID();
  req.headers["x-request-id"] = id;
  res.setHeader("X-Request-Id", id);
  next();
}

// ── 2. Suspicious Pattern Detector ───────────────────────────────────────────
const SUSPICIOUS_PATTERNS = [
  /\.\.[/\\]/,                          // path traversal
  /<script[\s>]/i,                       // XSS script tag
  /javascript:/i,                        // JS protocol injection
  /on\w+\s*=/i,                          // inline event handlers
  /union\s+select/i,                     // SQL injection
  /exec\s*\(/i,                          // SQL exec
  /\bor\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?/i, // OR 1=1
  /\bdrop\s+table\b/i,                   // SQL DROP
  /\binsert\s+into\b/i,                  // SQL INSERT probe
];

export function suspiciousPatternDetector(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const checkString = (s: string): boolean =>
    SUSPICIOUS_PATTERNS.some((p) => p.test(s));

  const url = decodeURIComponent(req.url);
  if (checkString(url)) {
    console.warn(`[Security] Suspicious URL pattern from ${req.ip}: ${req.url}`);
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  // Check query string values
  for (const val of Object.values(req.query)) {
    if (typeof val === "string" && checkString(val)) {
      console.warn(`[Security] Suspicious query param from ${req.ip}`);
      res.status(400).json({ error: "Invalid request" });
      return;
    }
  }

  next();
}

// ── 3. Content-Type Enforcement ───────────────────────────────────────────────
export function enforceJsonContentType(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (
    ["POST", "PUT", "PATCH"].includes(req.method) &&
    req.path.startsWith("/api/trpc") &&
    req.headers["content-type"] &&
    !req.headers["content-type"].includes("application/json") &&
    !req.headers["content-type"].includes("multipart/form-data")
  ) {
    res.status(415).json({ error: "Unsupported Media Type" });
    return;
  }
  next();
}

// ── 4. XSS Sanitizer (strip dangerous HTML from string values) ────────────────
const XSS_PATTERN = /<[^>]*>|javascript:|on\w+\s*=/gi;

export function sanitizeString(input: string): string {
  return input.replace(XSS_PATTERN, "").trim();
}

// ── 5. Security Event Logger ──────────────────────────────────────────────────
export interface SecurityEvent {
  type:
    | "AUTH_FAILURE"
    | "RATE_LIMIT"
    | "SUSPICIOUS_INPUT"
    | "UNAUTHORIZED_ACCESS"
    | "ADMIN_ACTION"
    | "SENSITIVE_DATA_ACCESS";
  userId?: number;
  ip: string;
  path: string;
  detail?: string;
  timestamp: Date;
}

const securityLog: SecurityEvent[] = [];
const MAX_LOG_SIZE = 10_000;

export function logSecurityEvent(event: Omit<SecurityEvent, "timestamp">) {
  const entry: SecurityEvent = { ...event, timestamp: new Date() };
  securityLog.push(entry);
  if (securityLog.length > MAX_LOG_SIZE) {
    securityLog.splice(0, securityLog.length - MAX_LOG_SIZE);
  }
  if (
    event.type === "SUSPICIOUS_INPUT" ||
    event.type === "UNAUTHORIZED_ACCESS"
  ) {
    console.warn(`[SecurityEvent] ${JSON.stringify(entry)}`);
  }
}

export function getRecentSecurityEvents(limit = 100): SecurityEvent[] {
  return securityLog.slice(-limit).reverse();
}

// ── 6. IP Blocklist (in-memory, for rate-abuse IPs) ───────────────────────────
const blockedIPs = new Set<string>();
const blockExpiry = new Map<string, number>();

export function blockIP(ip: string, durationMs = 15 * 60 * 1000) {
  blockedIPs.add(ip);
  blockExpiry.set(ip, Date.now() + durationMs);
  console.warn(`[Security] Blocked IP ${ip} for ${durationMs / 1000}s`);
}

export function ipBlocklistMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const ip = req.ip || req.socket.remoteAddress || "";
  if (blockedIPs.has(ip)) {
    const expiry = blockExpiry.get(ip) || 0;
    if (Date.now() > expiry) {
      blockedIPs.delete(ip);
      blockExpiry.delete(ip);
    } else {
      res.status(429).json({ error: "Too many requests" });
      return;
    }
  }
  next();
}

// ── 7. Security Headers Audit ─────────────────────────────────────────────────
export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cache-Control": "no-store",
} as const;

export function securityHeaders(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Only apply to non-static routes
  if (!req.path.startsWith("/assets/") && !req.path.startsWith("/icons/")) {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(key, value);
    }
  }
  next();
}
