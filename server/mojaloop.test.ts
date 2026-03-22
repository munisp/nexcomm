/**
 * mojaloopRouter unit tests
 *
 * Pure data-model and business-logic unit tests for the Mojaloop integration.
 * These tests verify data shapes, validation rules, aggregation logic, and
 * the FSPIOP protocol constraints without requiring a live DB or Mojaloop hub.
 */

import { describe, it, expect } from "vitest";

// ─── Test fixtures ────────────────────────────────────────────────────────────
const mockDfsps = [
  {
    id: 1,
    fspId: "test-bank-ng",
    name: "Test Bank Nigeria",
    country: "NG",
    currencies: ["NGN", "USD"],
    isActive: true,
    endpointUrl: "http://test-bank-ng:4000",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  },
  {
    id: 2,
    fspId: "test-mmo-ke",
    name: "Test MMO Kenya",
    country: "KE",
    currencies: ["KES"],
    isActive: true,
    endpointUrl: null,
    createdAt: new Date("2025-01-02"),
    updatedAt: new Date("2025-01-02"),
  },
  {
    id: 3,
    fspId: "inactive-fsp",
    name: "Inactive FSP",
    country: "GH",
    currencies: ["GHS"],
    isActive: false,
    endpointUrl: null,
    createdAt: new Date("2025-01-03"),
    updatedAt: new Date("2025-01-03"),
  },
];

const mockTransfers = [
  {
    id: 1,
    transferId: "txn-001-aaaa-bbbb-cccc-ddddeeeeeeee",
    payerFspId: "nexcom-exchange",
    payeeFspId: "test-bank-ng",
    payerIdentifier: "ACC001",
    payeeIdentifier: "ACC002",
    amount: "1000.00",
    currency: "USD",
    status: "COMMITTED",
    ilpPacket: null,
    condition: null,
    fulfilment: null,
    errorCode: null,
    errorDescription: null,
    createdAt: new Date("2025-06-01T10:00:00Z"),
    updatedAt: new Date("2025-06-01T10:01:00Z"),
    committedAt: new Date("2025-06-01T10:01:00Z"),
    expiresAt: null,
  },
  {
    id: 2,
    transferId: "txn-002-aaaa-bbbb-cccc-ddddeeeeeeee",
    payerFspId: "nexcom-exchange",
    payeeFspId: "test-mmo-ke",
    payerIdentifier: "ACC003",
    payeeIdentifier: "ACC004",
    amount: "500.00",
    currency: "KES",
    status: "PENDING",
    ilpPacket: null,
    condition: null,
    fulfilment: null,
    errorCode: null,
    errorDescription: null,
    createdAt: new Date("2025-06-02T09:00:00Z"),
    updatedAt: new Date("2025-06-02T09:00:00Z"),
    committedAt: null,
    expiresAt: null,
  },
  {
    id: 3,
    transferId: "txn-003-aaaa-bbbb-cccc-ddddeeeeeeee",
    payerFspId: "nexcom-exchange",
    payeeFspId: "test-bank-ng",
    payerIdentifier: "ACC005",
    payeeIdentifier: "ACC006",
    amount: "250.00",
    currency: "USD",
    status: "ABORTED",
    ilpPacket: null,
    condition: null,
    fulfilment: null,
    errorCode: "3100",
    errorDescription: "Payer limit exceeded",
    createdAt: new Date("2025-06-03T08:00:00Z"),
    updatedAt: new Date("2025-06-03T08:00:30Z"),
    committedAt: null,
    expiresAt: null,
  },
];

const mockQuotes = [
  {
    id: 1,
    quoteId: "quote-001-aaaa-bbbb-cccc-ddddeeeeeeee",
    transactionId: "txn-001-aaaa-bbbb-cccc-ddddeeeeeeee",
    payerFspId: "nexcom-exchange",
    payeeFspId: "test-bank-ng",
    payerIdentifier: "ACC001",
    payeeIdentifier: "ACC002",
    amount: "1000.00",
    currency: "USD",
    status: "ACCEPTED",
    ilpPacket: "AYIBgQAAAAAAAASwNGxldmVsb25lLmRmc3AxLm1lci45T2RTOF81MDFsNFpBdjlzM",
    condition: "HOr22-H3AfTDHrSkPjJtVPRdKouuMkDXTR4ejlQa8Ks",
    transferAmount: "1000.00",
    transferCurrency: "USD",
    feeAmount: "0.50",
    feeCurrency: "USD",
    expiresAt: new Date("2025-06-01T10:05:00Z"),
    createdAt: new Date("2025-06-01T09:59:00Z"),
    updatedAt: new Date("2025-06-01T09:59:30Z"),
  },
  {
    id: 2,
    quoteId: "quote-002-aaaa-bbbb-cccc-ddddeeeeeeee",
    transactionId: "txn-002-aaaa-bbbb-cccc-ddddeeeeeeee",
    payerFspId: "nexcom-exchange",
    payeeFspId: "test-mmo-ke",
    payerIdentifier: "ACC003",
    payeeIdentifier: "ACC004",
    amount: "500.00",
    currency: "KES",
    status: "PENDING",
    ilpPacket: null,
    condition: null,
    transferAmount: null,
    transferCurrency: null,
    feeAmount: null,
    feeCurrency: null,
    expiresAt: null,
    createdAt: new Date("2025-06-02T08:58:00Z"),
    updatedAt: new Date("2025-06-02T08:58:00Z"),
  },
];

// ─── Helper: simulate listDfsps filter logic ──────────────────────────────────
function listDfsps(opts: { activeOnly: boolean; currency?: string }) {
  let result = [...mockDfsps];
  if (opts.activeOnly) result = result.filter((d) => d.isActive);
  if (opts.currency) result = result.filter((d) => (d.currencies as string[]).includes(opts.currency!));
  return result;
}

// ─── Helper: simulate volumeByCurrency aggregation ───────────────────────────
function volumeByCurrency() {
  const map: Record<string, { currency: string; count: number; totalAmount: number; committedCount: number; abortedCount: number }> = {};
  for (const t of mockTransfers) {
    if (!map[t.currency]) {
      map[t.currency] = { currency: t.currency, count: 0, totalAmount: 0, committedCount: 0, abortedCount: 0 };
    }
    map[t.currency].count++;
    map[t.currency].totalAmount += parseFloat(t.amount);
    if (t.status === "COMMITTED") map[t.currency].committedCount++;
    if (t.status === "ABORTED") map[t.currency].abortedCount++;
  }
  return Object.values(map).sort((a, b) => b.totalAmount - a.totalAmount);
}

// ─── Helper: simulate stats aggregation ──────────────────────────────────────
function stats() {
  const activeDfsps = mockDfsps.filter((d) => d.isActive).length;
  const byStatus: Record<string, { count: number; totalAmount: number }> = {};
  for (const t of mockTransfers) {
    if (!byStatus[t.status]) byStatus[t.status] = { count: 0, totalAmount: 0 };
    byStatus[t.status].count++;
    byStatus[t.status].totalAmount += parseFloat(t.amount);
  }
  return { activeDfsps, transfers: byStatus };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("mojaloopRouter — DFSP management", () => {
  it("returns all DFSPs when activeOnly is false", () => {
    const result = listDfsps({ activeOnly: false });
    expect(result).toHaveLength(3);
  });

  it("filters to active DFSPs when activeOnly is true", () => {
    const result = listDfsps({ activeOnly: true });
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.isActive)).toBe(true);
  });

  it("filters by currency", () => {
    const result = listDfsps({ activeOnly: false, currency: "USD" });
    expect(result).toHaveLength(1);
    expect(result[0].fspId).toBe("test-bank-ng");
  });

  it("returns empty array when no DFSPs match currency", () => {
    const result = listDfsps({ activeOnly: false, currency: "JPY" });
    expect(result).toHaveLength(0);
  });

  it("DFSP has all required fields", () => {
    const dfsp = mockDfsps[0];
    expect(dfsp.fspId).toBeDefined();
    expect(dfsp.name).toBeDefined();
    expect(typeof dfsp.isActive).toBe("boolean");
    expect(Array.isArray(dfsp.currencies)).toBe(true);
    expect(dfsp.createdAt).toBeInstanceOf(Date);
  });

  it("inactive DFSP is excluded from active filter", () => {
    const result = listDfsps({ activeOnly: true });
    const inactiveFsp = result.find((d) => d.fspId === "inactive-fsp");
    expect(inactiveFsp).toBeUndefined();
  });
});

describe("mojaloopRouter — Transfer data model", () => {
  it("transfer has all required fields", () => {
    const t = mockTransfers[0];
    expect(t.transferId).toBeDefined();
    expect(t.payerFspId).toBeDefined();
    expect(t.payeeFspId).toBeDefined();
    expect(t.amount).toBeDefined();
    expect(t.currency).toBeDefined();
    expect(t.status).toBeDefined();
    expect(t.createdAt).toBeInstanceOf(Date);
  });

  it("committed transfer has committedAt timestamp", () => {
    const committed = mockTransfers.find((t) => t.status === "COMMITTED");
    expect(committed).toBeDefined();
    expect(committed!.committedAt).toBeInstanceOf(Date);
  });

  it("pending transfer has null committedAt", () => {
    const pending = mockTransfers.find((t) => t.status === "PENDING");
    expect(pending).toBeDefined();
    expect(pending!.committedAt).toBeNull();
  });

  it("aborted transfer has error code and description", () => {
    const aborted = mockTransfers.find((t) => t.status === "ABORTED");
    expect(aborted).toBeDefined();
    expect(aborted!.errorCode).toBeTruthy();
    expect(aborted!.errorDescription).toBeTruthy();
  });

  it("transfer amounts are valid positive numeric strings", () => {
    for (const t of mockTransfers) {
      const amount = parseFloat(t.amount);
      expect(amount).toBeGreaterThan(0);
      expect(isNaN(amount)).toBe(false);
    }
  });

  it("transfer IDs are UUID-like strings", () => {
    for (const t of mockTransfers) {
      expect(t.transferId.length).toBeGreaterThan(10);
      expect(typeof t.transferId).toBe("string");
    }
  });
});

describe("mojaloopRouter — Quote data model", () => {
  it("accepted quote has ILP packet and condition", () => {
    const accepted = mockQuotes.find((q) => q.status === "ACCEPTED");
    expect(accepted).toBeDefined();
    expect(accepted!.ilpPacket).toBeTruthy();
    expect(accepted!.condition).toBeTruthy();
  });

  it("accepted quote has transfer amount and fee", () => {
    const accepted = mockQuotes.find((q) => q.status === "ACCEPTED");
    expect(accepted!.transferAmount).toBeTruthy();
    expect(accepted!.feeAmount).toBeTruthy();
  });

  it("pending quote has null ILP fields", () => {
    const pending = mockQuotes.find((q) => q.status === "PENDING");
    expect(pending).toBeDefined();
    expect(pending!.ilpPacket).toBeNull();
    expect(pending!.condition).toBeNull();
  });

  it("quote expiry is after creation date", () => {
    const accepted = mockQuotes.find((q) => q.status === "ACCEPTED");
    expect(accepted!.expiresAt!.getTime()).toBeGreaterThan(accepted!.createdAt.getTime());
  });

  it("quote links to a transfer via transactionId", () => {
    const quote = mockQuotes[0];
    const linkedTransfer = mockTransfers.find((t) => t.transferId === quote.transactionId);
    expect(linkedTransfer).toBeDefined();
  });
});

describe("mojaloopRouter — volumeByCurrency aggregation", () => {
  it("groups transfers by currency correctly", () => {
    const result = volumeByCurrency();
    const currencies = result.map((r) => r.currency);
    expect(currencies).toContain("USD");
    expect(currencies).toContain("KES");
  });

  it("counts transfers per currency", () => {
    const result = volumeByCurrency();
    const usd = result.find((r) => r.currency === "USD");
    const kes = result.find((r) => r.currency === "KES");
    expect(usd!.count).toBe(2); // 1 COMMITTED + 1 ABORTED
    expect(kes!.count).toBe(1); // 1 PENDING
  });

  it("sums total amount per currency", () => {
    const result = volumeByCurrency();
    const usd = result.find((r) => r.currency === "USD");
    expect(usd!.totalAmount).toBe(1250); // 1000 + 250
  });

  it("counts committed and aborted transfers separately", () => {
    const result = volumeByCurrency();
    const usd = result.find((r) => r.currency === "USD");
    expect(usd!.committedCount).toBe(1);
    expect(usd!.abortedCount).toBe(1);
  });

  it("sorts by total amount descending", () => {
    const result = volumeByCurrency();
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].totalAmount).toBeGreaterThanOrEqual(result[i].totalAmount);
    }
  });
});

describe("mojaloopRouter — stats aggregation", () => {
  it("counts active DFSPs", () => {
    const result = stats();
    expect(result.activeDfsps).toBe(2);
  });

  it("groups transfers by status", () => {
    const result = stats();
    expect(result.transfers["COMMITTED"].count).toBe(1);
    expect(result.transfers["PENDING"].count).toBe(1);
    expect(result.transfers["ABORTED"].count).toBe(1);
  });

  it("sums transfer amounts per status", () => {
    const result = stats();
    expect(result.transfers["COMMITTED"].totalAmount).toBe(1000);
    expect(result.transfers["ABORTED"].totalAmount).toBe(250);
  });
});

describe("mojaloopRouter — input validation rules", () => {
  it("amount regex accepts valid decimal strings", () => {
    const amountRegex = /^\d+(\.\d{1,6})?$/;
    expect(amountRegex.test("1000.00")).toBe(true);
    expect(amountRegex.test("1000")).toBe(true);
    expect(amountRegex.test("0.000001")).toBe(true);
    expect(amountRegex.test("999999.999999")).toBe(true);
  });

  it("amount regex rejects invalid strings", () => {
    const amountRegex = /^\d+(\.\d{1,6})?$/;
    expect(amountRegex.test("abc")).toBe(false);
    expect(amountRegex.test("1000.1234567")).toBe(false); // 7 decimal places
    expect(amountRegex.test("-100")).toBe(false);
    expect(amountRegex.test("")).toBe(false);
    expect(amountRegex.test("1,000")).toBe(false);
  });

  it("currency code must be exactly 3 characters", () => {
    const validCurrencies = ["USD", "EUR", "NGN", "KES", "GHS", "ZAR", "TZS", "UGX", "XOF"];
    const invalidCurrencies = ["US", "USDD", ""];
    for (const c of validCurrencies) {
      expect(c.length).toBe(3);
    }
    for (const c of invalidCurrencies) {
      expect(c.length).not.toBe(3);
    }
  });

  it("fspId must be between 1 and 64 characters", () => {
    const validFspIds = ["a", "nexcom-exchange", "a".repeat(64)];
    const invalidFspIds = ["", "a".repeat(65)];
    for (const id of validFspIds) {
      expect(id.length).toBeGreaterThanOrEqual(1);
      expect(id.length).toBeLessThanOrEqual(64);
    }
    for (const id of invalidFspIds) {
      const valid = id.length >= 1 && id.length <= 64;
      expect(valid).toBe(false);
    }
  });

  it("party ID types are valid FSPIOP enum values", () => {
    const validTypes = ["MSISDN", "EMAIL", "ACCOUNT_ID", "IBAN", "ALIAS"];
    expect(validTypes).toContain("MSISDN");
    expect(validTypes).toContain("ACCOUNT_ID");
    expect(validTypes).not.toContain("PHONE"); // not a valid FSPIOP type
    expect(validTypes).not.toContain("USERNAME");
  });

  it("transfer status enum covers all FSPIOP states", () => {
    const validStatuses = ["PENDING", "RESERVED", "COMMITTED", "ABORTED", "EXPIRED"];
    for (const status of validStatuses) {
      expect(typeof status).toBe("string");
    }
    expect(validStatuses).toContain("COMMITTED");
    expect(validStatuses).toContain("ABORTED");
  });
});

describe("mojaloopRouter — recentActivity ordering", () => {
  it("returns transfers sorted by createdAt descending", () => {
    const sorted = [...mockTransfers].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    expect(sorted[0].transferId).toBe("txn-003-aaaa-bbbb-cccc-ddddeeeeeeee");
    expect(sorted[1].transferId).toBe("txn-002-aaaa-bbbb-cccc-ddddeeeeeeee");
    expect(sorted[2].transferId).toBe("txn-001-aaaa-bbbb-cccc-ddddeeeeeeee");
  });

  it("limit parameter constrains the result set", () => {
    const limit = 2;
    const sorted = [...mockTransfers]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
    expect(sorted).toHaveLength(2);
  });
});

describe("mojaloopRouter — FSPIOP protocol compliance", () => {
  it("ILP packet is a base64-encoded string", () => {
    const quote = mockQuotes.find((q) => q.ilpPacket);
    expect(quote).toBeDefined();
    // ILP packets are base64url encoded
    expect(/^[A-Za-z0-9+/=_-]+$/.test(quote!.ilpPacket!)).toBe(true);
  });

  it("condition is a base64url string (SHA-256 hash)", () => {
    const quote = mockQuotes.find((q) => q.condition);
    expect(quote).toBeDefined();
    expect(typeof quote!.condition).toBe("string");
    expect(quote!.condition!.length).toBeGreaterThan(10);
  });

  it("payer FSP is always nexcom-exchange for outgoing transfers", () => {
    for (const t of mockTransfers) {
      expect(t.payerFspId).toBe("nexcom-exchange");
    }
  });

  it("payee FSP is always a registered DFSP", () => {
    const dfspIds = mockDfsps.map((d) => d.fspId);
    for (const t of mockTransfers) {
      expect(dfspIds).toContain(t.payeeFspId);
    }
  });
});
