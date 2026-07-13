# NEXCOM Exchange — Security Vulnerability Report (Round 70)

**Date:** 2026-07-13
**Status:** All 5 findings remediated in this release

## Findings Summary

| ID | Severity | Category | Component | Status |
|----|----------|----------|-----------|--------|
| NEXCOM-R70-001 | Medium | Missing Rate Limit | smartFillRouter / aiMlRouter | Fixed |
| NEXCOM-R70-002 | Medium | Missing Rate Limit | kycRouter / amlRouter | Fixed |
| NEXCOM-R70-003 | Low | Missing Rate Limit | multiCurrencyRouter / crossBorderFxRouter | Fixed |
| NEXCOM-R70-004 | High | SQL Injection | pg-optimizations.ts batchInsertTrades | Fixed |
| NEXCOM-R70-005 | Medium | Weak Credential | JWT secret minimum-length enforcement | Fixed |

## NEXCOM-R70-001 — Missing Rate Limit on AI Endpoints (Medium)

The AI-powered Smart Fill endpoint and AI/ML analytics endpoint were not covered by any per-IP rate limiter. Each request invokes a large-language model incurring API cost. An attacker could flood these endpoints to exhaust LLM budget or degrade service.

**Fix:** aiLimiter added (20 req/min per IP) covering /api/trpc/smartFill and /api/trpc/aiMl.

## NEXCOM-R70-002 — Missing Rate Limit on KYC/AML Endpoints (Medium)

KYC document submission and AML screening endpoints were not rate-limited. These call external OpenSanctions and identity verification APIs. Unrestricted access could allow enumeration of sanctions lists or quota exhaustion.

**Fix:** kycAmlLimiter added (30 req/min per IP) covering /api/trpc/kyc and /api/trpc/aml.

## NEXCOM-R70-003 — Missing Rate Limit on Multi-Currency Endpoints (Low)

Cross-border FX and multi-currency conversion endpoints queried live FX rate providers without rate limiting.

**Fix:** multiCurrencyLimiter added (60 req/min per IP) covering /api/trpc/multiCurrency and /api/trpc/crossBorderFx.

## NEXCOM-R70-004 — SQL Injection Risk in Batch Trade Insert (High)

The batchInsertTrades function in pg-optimizations.ts constructed a SQL VALUES clause by string-interpolating trade record fields directly into sql.raw(). Although currently only called from internal server-side code, the pattern is inherently unsafe and would constitute a full SQL injection vulnerability if call sites were extended to accept user-supplied data.

**Fix:** Rewritten to use Drizzle ORM parameterised sql tagged template literals — each value is passed as a bound parameter, never interpolated into SQL text.

## NEXCOM-R70-005 — Weak JWT Secret Minimum-Length Enforcement (Medium)

The application signed session cookies using JWT_SECRET without validating minimum length at startup. A secret shorter than 32 characters is vulnerable to offline brute-force.

**Fix:** Startup guard added — warns in development, terminates process in production if JWT_SECRET < 32 chars.

## Open-Source Component Vulnerability Status

| Package | Version | Known CVEs | Status |
|---------|---------|------------|--------|
| express | 4.x | None critical | Clean |
| express-rate-limit | 7.x | None | Clean |
| helmet | 8.x | None | Clean |
| drizzle-orm | 0.44.x | None | Clean |
| @trpc/server | 11.x | None | Clean |
| zod | 3.x | None | Clean |
| jsonwebtoken | 9.x | None critical | Clean |
| postgres | 3.x | None | Clean |
| stripe | 17.x | None | Clean |
| react | 19.x | None | Clean |
| vite | 6.x | None critical | Clean |

No high or critical severity vulnerabilities found in direct or transitive dependencies as of 2026-07-13.

## Recommendations for Future Hardening

1. CSP tightening — migrate from unsafe-inline to nonce-based CSP.
2. Refresh token rotation — implement short-lived access tokens (15 min) with rotating refresh tokens.
3. Dependency pinning — pin all package.json dependencies to exact versions and use npm ci in CI/CD.
4. Secrets scanning in CI — add gitleaks or trufflehog to the GitHub Actions pipeline.
