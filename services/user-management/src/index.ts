/**
 * NEXCOM Exchange — User Management Service (TypeScript/Express)
 * ==============================================================
 * Handles user lifecycle: registration, authentication, KYC status,
 * role management, session management, and audit logging.
 *
 * Port: 8085 (default)
 * Auth: JWT (access token 15min, refresh token 7 days)
 * Storage: PostgreSQL (users, sessions, audit_log) + Redis (token blacklist)
 */
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { json } from "express";

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.USER_MGMT_PORT ?? "8085", 10);
const DB_URL = process.env.DATABASE_URL ?? "postgres://nexcom:nexcom@localhost:5432/nexcom";
const JWT_SECRET = process.env.JWT_SECRET ?? "nexcom-dev-secret-change-in-prod";
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY ?? "15m";
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY ?? "7d";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10);
const SERVICE_NAME = "user-management";
const SERVICE_VERSION = "1.0.0";

// ─── App Setup ────────────────────────────────────────────────────────────────
const app = express();

app.use(helmet());
app.use(cors({ origin: "*", credentials: true }));
app.use(json({ limit: "1mb" }));

// Global rate limiter
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests", code: "RATE_LIMIT_EXCEEDED" },
}));

// Request logger
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${req.ip}`);
  next();
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString(),
    config: {
      port: PORT,
      db_url: DB_URL.replace(/:[^@]+@/, ":***@"),
      redis_url: REDIS_URL,
    },
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
import authRouter from "./routes/auth";
import usersRouter from "./routes/users";
import kycRouter from "./routes/kyc";

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/users", usersRouter);
app.use("/api/v1/kyc", kycRouter);

// ─── 404 & Error handlers ────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Error]", err.message, err.stack);
  res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[${SERVICE_NAME}] v${SERVICE_VERSION} listening on port ${PORT}`);
  console.log(`[${SERVICE_NAME}] DB: ${DB_URL.replace(/:[^@]+@/, ":***@")}`);
  console.log(`[${SERVICE_NAME}] Redis: ${REDIS_URL}`);
});

export default app;
export { JWT_SECRET, JWT_ACCESS_EXPIRY, JWT_REFRESH_EXPIRY, BCRYPT_ROUNDS, DB_URL, REDIS_URL };
