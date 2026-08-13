import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type TransferRequest = Readonly<{
  actorId: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinor: bigint;
  currency: "NGN" | "USD";
  idempotencyKey: string;
}>;

export type TransferResult = Readonly<{
  operationId: string;
  status: "committed";
  amountMinor: bigint;
  currency: "NGN" | "USD";
  idempotentReplay: boolean;
}>;

type StoredOperation = {
  operationId: string;
  requestHash: string;
  result: { operationId: string; status: "committed"; amountMinor: string; currency: "NGN" | "USD" };
};

type AuditEvent = {
  eventId: string;
  operationId: string;
  occurredAtUtc: string;
  actorId: string;
  action: "transfer.committed";
  amountMinor: string;
  currency: "NGN" | "USD";
  requestHash: string;
  previousHash: string | null;
  eventHash: string;
};

function canonicalRequest(request: TransferRequest) {
  return JSON.stringify({
    actorId: request.actorId,
    fromAccountId: request.fromAccountId,
    toAccountId: request.toAccountId,
    amountMinor: request.amountMinor.toString(),
    currency: request.currency,
    idempotencyKey: request.idempotencyKey,
  });
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function toResult(stored: StoredOperation, idempotentReplay: boolean): TransferResult {
  return {
    operationId: stored.result.operationId,
    status: stored.result.status,
    amountMinor: BigInt(stored.result.amountMinor),
    currency: stored.result.currency,
    idempotentReplay,
  };
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency key has already been used for a different request");
  }
}

export class TransferValidationError extends Error {}

/**
 * A durable file-backed test-store. It serializes all writes in process, writes a
 * replacement file before rename, and uses the idempotency key as the durable
 * operation identity. This is intentionally a test fixture, not a production ledger.
 */
export class FileBackedTransferStore {
  private readonly directory: string;
  private readonly operationsPath: string;
  private readonly auditPath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(directory: string) {
    this.directory = directory;
    this.operationsPath = path.join(directory, "operations.json");
    this.auditPath = path.join(directory, "audit.jsonl");
  }

  async commit(request: TransferRequest): Promise<TransferResult> {
    this.validate(request);
    const requestHash = sha256(canonicalRequest(request));
    let result: TransferResult | undefined;
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const operations = await this.readOperations();
      const prior = operations[request.idempotencyKey];
      if (prior) {
        if (prior.requestHash !== requestHash) throw new IdempotencyConflictError();
        result = toResult(prior, true);
        return;
      }

      const operationId = randomUUID();
      const stored: StoredOperation = {
        operationId,
        requestHash,
        result: { operationId, status: "committed", amountMinor: request.amountMinor.toString(), currency: request.currency },
      };
      operations[request.idempotencyKey] = stored;
      await this.writeOperationsAtomically(operations);
      await this.appendAuditEvent(request, stored);
      result = toResult(stored, false);
    });
    await this.writeQueue;
    if (!result) throw new Error("transfer operation did not produce a durable result");
    return result;
  }

  async operationCount(): Promise<number> {
    return Object.keys(await this.readOperations()).length;
  }

  async readAuditEvents(): Promise<AuditEvent[]> {
    try {
      const content = await readFile(this.auditPath, "utf8");
      return content.trim() === "" ? [] : content.trim().split("\n").map((line) => JSON.parse(line));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private validate(request: TransferRequest) {
    if (!request.actorId || !request.fromAccountId || !request.toAccountId || !request.idempotencyKey) throw new TransferValidationError("actor, accounts, and idempotency key are required");
    if (request.fromAccountId === request.toAccountId) throw new TransferValidationError("source and destination accounts must differ");
    if (request.amountMinor <= 0n) throw new TransferValidationError("amountMinor must be positive");
  }

  private async readOperations(): Promise<Record<string, StoredOperation>> {
    try {
      return JSON.parse(await readFile(this.operationsPath, "utf8"));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  private async writeOperationsAtomically(operations: Record<string, StoredOperation>) {
    const temporaryPath = `${this.operationsPath}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "w", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(operations, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, this.operationsPath);
  }

  private async appendAuditEvent(request: TransferRequest, stored: StoredOperation) {
    const events = await this.readAuditEvents();
    const previousHash = events.at(-1)?.eventHash ?? null;
    const unsigned = {
      eventId: randomUUID(), operationId: stored.operationId, occurredAtUtc: new Date().toISOString(), actorId: request.actorId,
      action: "transfer.committed" as const, amountMinor: request.amountMinor.toString(), currency: request.currency, requestHash: stored.requestHash, previousHash,
    };
    const event: AuditEvent = { ...unsigned, eventHash: sha256(JSON.stringify(unsigned)) };
    const handle = await open(this.auditPath, "a", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
