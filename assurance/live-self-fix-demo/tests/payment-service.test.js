import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileBackedPaymentService, IdempotencyConflictError, PaymentValidationError } from "../src/payment-service.js";

async function withService(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "assurance-payment-"));
  try {
    await run(new FileBackedPaymentService(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function request(overrides = {}) {
  return { accountId: "acct-demo-1", amountMinor: 12500n, idempotencyKey: "demo-payment-1", ...overrides };
}

test("persists one payment and returns the same operation for a real retry", async () => {
  await withService(async (service) => {
    const first = await service.submitPayment(request());
    const retry = await service.submitPayment(request());
    assert.equal(first.status, "accepted");
    assert.equal(retry.paymentId, first.paymentId);
    assert.equal(retry.idempotentReplay, true);
    assert.equal(await service.operationCount(), 1);
  });
});

test("rejects conflicting reuse of an idempotency key", async () => {
  await withService(async (service) => {
    await service.submitPayment(request());
    await assert.rejects(service.submitPayment(request({ amountMinor: 12501n })), IdempotencyConflictError);
    assert.equal(await service.operationCount(), 1);
  });
});

test("rejects invalid input before durable state is written", async () => {
  await withService(async (service) => {
    await assert.rejects(service.submitPayment(request({ amountMinor: 0n })), PaymentValidationError);
    assert.equal(await service.operationCount(), 0);
  });
});

test("serializes concurrent duplicate requests into one durable payment", async () => {
  await withService(async (service) => {
    const results = await Promise.all(Array.from({ length: 12 }, () => service.submitPayment(request({ idempotencyKey: "concurrent-payment-1" }))));
    assert.equal(new Set(results.map((result) => result.paymentId)).size, 1);
    assert.equal(results.filter((result) => !result.idempotentReplay).length, 1);
    assert.equal(await service.operationCount(), 1);
  });
});
