import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileBackedTransferStore, IdempotencyConflictError, TransferValidationError } from "../src/transfer.ts";

async function withStore(run: (store: FileBackedTransferStore) => Promise<void>) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "assurance-transfer-"));
  try {
    await run(new FileBackedTransferStore(workspace));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function request(overrides: Partial<{ actorId: string; fromAccountId: string; toAccountId: string; amountMinor: bigint; currency: "NGN" | "USD"; idempotencyKey: string; }> = {}) {
  return {
    actorId: "actor-test-1",
    fromAccountId: "ledger-cash-001",
    toAccountId: "ledger-settlement-001",
    amountMinor: 125_000n,
    currency: "NGN" as const,
    idempotencyKey: "transfer-test-key-001",
    ...overrides,
  };
}

test("commits once and replays the identical idempotency key without a duplicate durable operation", async () => {
  await withStore(async (store) => {
    const first = await store.commit(request());
    const replay = await store.commit(request());
    assert.equal(first.status, "committed");
    assert.equal(first.idempotentReplay, false);
    assert.equal(replay.operationId, first.operationId);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(await store.operationCount(), 1);
    assert.equal((await store.readAuditEvents()).length, 1);
  });
});

test("serializes concurrent duplicate requests into one durable operation", async () => {
  await withStore(async (store) => {
    const results = await Promise.all(Array.from({ length: 20 }, () => store.commit(request({ idempotencyKey: "transfer-concurrent-001" }))));
    assert.equal(new Set(results.map((result) => result.operationId)).size, 1);
    assert.equal(results.filter((result) => !result.idempotentReplay).length, 1);
    assert.equal(await store.operationCount(), 1);
    assert.equal((await store.readAuditEvents()).length, 1);
  });
});

test("rejects conflicting reuse of an idempotency key", async () => {
  await withStore(async (store) => {
    await store.commit(request());
    await assert.rejects(store.commit(request({ amountMinor: 125_001n })), IdempotencyConflictError);
    assert.equal(await store.operationCount(), 1);
  });
});

test("rejects invalid transfers before any durable side effect", async () => {
  await withStore(async (store) => {
    await assert.rejects(store.commit(request({ amountMinor: 0n })), TransferValidationError);
    await assert.rejects(store.commit(request({ fromAccountId: "ledger-cash-001", toAccountId: "ledger-cash-001" })), TransferValidationError);
    assert.equal(await store.operationCount(), 0);
    assert.equal((await store.readAuditEvents()).length, 0);
  });
});

test("creates a linked tamper-evident audit history for distinct operations", async () => {
  await withStore(async (store) => {
    await store.commit(request({ idempotencyKey: "transfer-audit-001" }));
    await store.commit(request({ idempotencyKey: "transfer-audit-002", amountMinor: 200_000n }));
    const events = await store.readAuditEvents();
    assert.equal(events.length, 2);
    assert.equal(events[1].previousHash, events[0].eventHash);
    for (const event of events) {
      const unsigned = {
        eventId: event.eventId, operationId: event.operationId, occurredAtUtc: event.occurredAtUtc, actorId: event.actorId,
        action: event.action, amountMinor: event.amountMinor, currency: event.currency, requestHash: event.requestHash, previousHash: event.previousHash,
      };
      assert.equal(event.eventHash, createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"));
    }
  });
});
