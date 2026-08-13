import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class PaymentValidationError extends Error {}
export class IdempotencyConflictError extends Error {}

function requestFingerprint({ accountId, amountMinor, idempotencyKey }) {
  return JSON.stringify({ accountId, amountMinor: amountMinor.toString(), idempotencyKey });
}

export class FileBackedPaymentService {
  constructor(directory) {
    this.directory = directory;
    this.operationsPath = path.join(directory, "payment-operations.json");
    this.writeQueue = Promise.resolve();
  }

  async submitPayment({ accountId, amountMinor, idempotencyKey }) {
    if (!accountId || !idempotencyKey) throw new PaymentValidationError("accountId and idempotencyKey are required");
    if (typeof amountMinor !== "bigint" || amountMinor <= 0n) throw new PaymentValidationError("amountMinor must be a positive bigint");

    const fingerprint = requestFingerprint({ accountId, amountMinor, idempotencyKey });
    let outcome;
    const operation = this.writeQueue.catch(() => undefined).then(async () => {
      const operations = await this.readOperations();
      const previous = operations[idempotencyKey];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new IdempotencyConflictError("idempotency key belongs to a different payment request");
        outcome = { ...previous.result, idempotentReplay: true };
        return;
      }
      const result = { paymentId: randomUUID(), status: "accepted", amountMinor: amountMinor.toString(), idempotentReplay: false };
      operations[idempotencyKey] = { fingerprint, result: { ...result, idempotentReplay: false } };
      await this.writeOperationsAtomically(operations);
      outcome = result;
    });
    this.writeQueue = operation;
    await operation;
    return outcome;
  }

  async operationCount() {
    return Object.keys(await this.readOperations()).length;
  }

  async readOperations() {
    try {
      return JSON.parse(await readFile(this.operationsPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return {};
      throw error;
    }
  }

  async writeOperationsAtomically(operations) {
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.operationsPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(operations, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.operationsPath);
  }
}
