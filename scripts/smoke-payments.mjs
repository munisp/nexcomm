#!/usr/bin/env node
/**
 * smoke-payments.mjs — PAY-RAILS smoke test
 *
 * Exercises the webhook pipeline of a RUNNING server with the mock provider:
 *   1. unknown provider           → expect 404
 *   2. invalid webhook signature  → expect 401
 *   3. valid mock webhook         → expect 200 { received: true }
 *   4. duplicate event replay     → expect 200 { duplicate: true }
 *   5. (optional) authenticated tRPC initialize→verify flow when
 *      SMOKE_AUTH_COOKIE (session cookie) is provided.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 node scripts/smoke-payments.mjs
 *   BASE_URL=... SMOKE_AUTH_COOKIE="app_session=..." node scripts/smoke-payments.mjs
 *
 * Env: BASE_URL (default http://localhost:3000), MOCK_WEBHOOK_SECRET
 * (default mock-webhook-dev-secret — must match the server), SMOKE_AUTH_COOKIE.
 */
import crypto from "node:crypto";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.MOCK_WEBHOOK_SECRET ?? "mock-webhook-dev-secret";
const AUTH_COOKIE = process.env.SMOKE_AUTH_COOKIE ?? "";

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function sign(body) {
  return crypto.createHmac("sha256", SECRET).update(body).digest("hex");
}

async function postWebhook(provider, rawBody, signature) {
  const headers = { "Content-Type": "application/json" };
  if (signature) headers["x-mock-signature"] = signature;
  const res = await fetch(`${BASE_URL}/api/payments/${provider}/webhook`, {
    method: "POST",
    headers,
    body: rawBody,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

async function main() {
  console.log(`PAY-RAILS smoke test against ${BASE_URL}\n`);

  // 0. Server reachable
  try {
    await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
    record("server reachable", true);
  } catch {
    try {
      await fetch(BASE_URL, { signal: AbortSignal.timeout(5000) });
      record("server reachable", true);
    } catch (e) {
      record("server reachable", false, e.message);
      return summarize();
    }
  }

  // 1. Unknown provider → 404
  {
    const { status } = await postWebhook("not-a-rail", "{}", "deadbeef");
    record("unknown provider → 404", status === 404, `got ${status}`);
  }

  // 2. Invalid signature → 401
  {
    const body = JSON.stringify({ eventId: "smoke-bad-sig", type: "mock.payment", reference: "mock-smoke-x", status: "success" });
    const { status } = await postWebhook("mock", body, "0000dead0000");
    record("invalid signature → 401", status === 401, `got ${status}`);
  }

  // 3. Valid mock webhook → 200 received
  const eventId = `smoke-${Date.now()}`;
  const body = JSON.stringify({
    eventId,
    type: "mock.payment",
    reference: `mock-smoke-${Date.now()}`,
    status: "success",
    amountMinor: 500000,
    currency: "NGN",
  });
  {
    const { status, json } = await postWebhook("mock", body, sign(body));
    record("valid mock webhook → 200 received", status === 200 && json?.received === true, `got ${status} ${JSON.stringify(json)}`);
  }

  // 4. Replay same event → duplicate acknowledged, not reprocessed
  {
    const { status, json } = await postWebhook("mock", body, sign(body));
    record("duplicate event → 200 duplicate", status === 200 && json?.duplicate === true, `got ${status} ${JSON.stringify(json)}`);
  }

  // 5. Optional authenticated initialize→verify flow
  if (AUTH_COOKIE) {
    try {
      const input = {
        amountMinor: 100000,
        currency: "NGN",
        channel: "card",
        provider: "mock",
        idempotencyKey: `smoke-${crypto.randomUUID()}`,
        purpose: "deposit",
        origin: BASE_URL,
      };
      const initRes = await fetch(`${BASE_URL}/api/trpc/payments.initializeDeposit?batch=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: AUTH_COOKIE },
        body: JSON.stringify({ 0: { json: input } }),
      });
      const initJson = await initRes.json();
      const payment = initJson?.[0]?.result?.data?.json?.payment;
      if (initRes.ok && payment?.providerRef) {
        record("tRPC initializeDeposit (mock)", true, `ref ${payment.providerRef}`);

        // Wait for MOCK_SETTLE_SECONDS, then verify.
        await new Promise((r) => setTimeout(r, 6000));
        const verRes = await fetch(`${BASE_URL}/api/trpc/payments.verifyPayment?batch=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: AUTH_COOKIE },
          body: JSON.stringify({ 0: { json: { providerRef: payment.providerRef } } }),
        });
        const verJson = await verRes.json();
        const finalStatus = verJson?.[0]?.result?.data?.json?.payment?.status;
        record("tRPC verifyPayment → success", verRes.ok && finalStatus === "success", `status=${finalStatus}`);

        // Idempotent verify — second call must NOT re-settle.
        const ver2Res = await fetch(`${BASE_URL}/api/trpc/payments.verifyPayment?batch=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: AUTH_COOKIE },
          body: JSON.stringify({ 0: { json: { providerRef: payment.providerRef } } }),
        });
        const ver2Json = await ver2Res.json();
        const settle2 = ver2Json?.[0]?.result?.data?.json?.settle;
        record("verify idempotent (already-settled)", ver2Res.ok && settle2 === "already-settled", `settle=${settle2}`);
      } else {
        record("tRPC initializeDeposit (mock)", false, `HTTP ${initRes.status} ${JSON.stringify(initJson).slice(0, 200)}`);
      }
    } catch (e) {
      record("authenticated flow", false, e.message);
    }
  } else {
    console.log("SKIP  authenticated tRPC flow — set SMOKE_AUTH_COOKIE to enable");
  }

  summarize();
}

function summarize() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exit(1);
  console.log("SMOKE RESULT: PASS");
}

main().catch((e) => {
  console.error("SMOKE RESULT: FAIL —", e);
  process.exit(1);
});
