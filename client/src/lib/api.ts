/**
 * @deprecated This file is superseded by tRPC procedures (server/routers.ts).
 * All API calls in the portal use `trpc.*` hooks from client/src/lib/trpc.ts.
 * This file is retained for reference only and is NOT imported anywhere.
 *
 * NEXCOM Exchange — API Client
 * Design: Harvest Portal (Warm Agri-Tech)
 *
 * Connects to three backend services:
 *   - Matching Engine (Rust): http://localhost:8080
 *   - Settlement Service (Go): http://localhost:8082
 *   - Warehouse Integration (Go): http://localhost:8090
 *
 * Falls back to realistic mock data when backends are unavailable
 * (for demo / offline use).
 */

const ME_BASE = import.meta.env.VITE_MATCHING_ENGINE_URL || "http://localhost:8080";
const SETTLE_BASE = import.meta.env.VITE_SETTLEMENT_URL || "http://localhost:8082";
const WH_BASE = import.meta.env.VITE_WAREHOUSE_URL || "http://localhost:8090";

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Commodity {
  id: string;
  symbol: string;
  name: string;
  category: string;
  unit: string;
  currency: string;
  last_price: number;
  change_pct: number;
  volume_24h: number;
  description?: string;
}

export interface OrderBook {
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  timestamp: string;
}

export interface Order {
  order_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  order_type: "LIMIT" | "MARKET";
  price: number;
  quantity: number;
  filled_quantity: number;
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED";
  created_at: string;
  client_order_id?: string;
}

export interface Trade {
  trade_id: string;
  symbol: string;
  price: number;
  quantity: number;
  buyer_order_id: string;
  seller_order_id: string;
  executed_at: string;
}

export interface Warehouse {
  id: string;
  name: string;
  location: string;
  country: string;
  state?: string;
  capacity_mt: number;
  current_stock_mt: number;
  commodities: string[];
  certifications: string[];
  contact_email: string;
  contact_phone: string;
}

export interface GradeSpec {
  code: string;
  commodity: string;
  name: string;
  description: string;
  moisture_max_pct: number;
  impurity_max_pct: number;
  min_price_per_mt: number;
  max_price_per_mt: number;
  standard: string;
}

export interface Depositor {
  id: string;
  name: string;
  phone: string;
  email?: string;
  nin?: string;
  bvn?: string;
  kyc_status: "PENDING" | "APPROVED" | "REJECTED";
  account_type: "FARMER" | "TRADER" | "PROCESSOR";
  created_at: string;
}

export interface DepositRequest {
  id: string;
  depositor_id: string;
  warehouse_id: string;
  commodity: string;
  estimated_quantity_mt: number;
  status: "PENDING" | "COLLECTED" | "RECEIVED" | "GRADED" | "EWR_ISSUED" | "REJECTED";
  logistics_partner?: string;
  tracking_number?: string;
  created_at: string;
}

export interface GradingInspection {
  id: string;
  deposit_id: string;
  inspector_name: string;
  grade_code: string;
  accepted_quantity_mt: number;
  rejected_quantity_mt: number;
  moisture_pct: number;
  impurity_pct: number;
  notes?: string;
  inspected_at: string;
}

export interface EWR {
  id: string;
  receipt_number: string;
  depositor_id: string;
  warehouse_id: string;
  commodity: string;
  grade_code: string;
  quantity_mt: number;
  value_ngn: number;
  status: "ACTIVE" | "TRADED" | "DELIVERED" | "EXPIRED" | "CANCELLED";
  issued_at: string;
  expires_at: string;
  current_owner_id?: string;
}

export interface DeliveryOrder {
  id: string;
  ewr_id: string;
  buyer_id: string;
  warehouse_id: string;
  quantity_mt: number;
  status: "PENDING" | "SCHEDULED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";
  scheduled_date?: string;
  delivered_at?: string;
  logistics_partner?: string;
  tracking_number?: string;
}

export interface SettlementStats {
  total_settlements: number;
  total_volume_usd: number;
  avg_latency_ms: number;
  success_rate: number;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_COMMODITIES: Commodity[] = [
  { id: "ginger-ng", symbol: "GINGER-NG-SPOT", name: "Nigerian Ginger", category: "spice", unit: "MT", currency: "NGN", last_price: 850000, change_pct: 2.4, volume_24h: 142.5, description: "Premium split dried ginger from Kaduna/Bauchi belt" },
  { id: "maize-ng", symbol: "MAIZE-NG-SPOT", name: "White Maize", category: "grain", unit: "MT", currency: "NGN", last_price: 185000, change_pct: -0.8, volume_24h: 820.0, description: "Grade 1 white maize, moisture <14%" },
  { id: "cocoa-gh", symbol: "COCOA-GH-SPOT", name: "Ghana Cocoa", category: "softcommodity", unit: "MT", currency: "USD", last_price: 3200, change_pct: 1.2, volume_24h: 55.2, description: "Grade 1 fermented and dried cocoa beans" },
  { id: "sesame-et", symbol: "SESAME-ET-SPOT", name: "Ethiopian Sesame", category: "oilseed", unit: "MT", currency: "USD", last_price: 1450, change_pct: 0.5, volume_24h: 38.7, description: "Humera white sesame, 99% purity" },
  { id: "soya-ng", symbol: "SOYA-NG-SPOT", name: "Nigerian Soya", category: "oilseed", unit: "MT", currency: "NGN", last_price: 320000, change_pct: -1.1, volume_24h: 210.0, description: "Grade 1 soya beans" },
  { id: "cassava-ng", symbol: "CASSAVA-NG-SPOT", name: "Cassava Chips", category: "root", unit: "MT", currency: "NGN", last_price: 95000, change_pct: 3.2, volume_24h: 450.0, description: "Dried cassava chips, moisture <14%" },
  { id: "coffee-ke", symbol: "COFFEE-KE-SPOT", name: "Kenya AA Coffee", category: "softcommodity", unit: "MT", currency: "USD", last_price: 4800, change_pct: 0.9, volume_24h: 12.3, description: "Kenya AA washed arabica coffee" },
  { id: "cotton-ng", symbol: "COTTON-NG-SPOT", name: "Nigerian Cotton", category: "softcommodity", unit: "MT", currency: "NGN", last_price: 420000, change_pct: -0.3, volume_24h: 88.5, description: "Grade A seed cotton" },
];

const MOCK_WAREHOUSES: Warehouse[] = [
  { id: "WH-KAD-001", name: "Kaduna Commodity Hub", location: "Kaduna", country: "Nigeria", state: "Kaduna", capacity_mt: 50000, current_stock_mt: 12450, commodities: ["Ginger", "Sesame", "Soya"], certifications: ["AFEX", "ISO 9001", "NAFDAC"], contact_email: "kaduna@nexcom.ng", contact_phone: "+234-800-001-0001" },
  { id: "WH-BAU-001", name: "Bauchi Agro Hub", location: "Bauchi", country: "Nigeria", state: "Bauchi", capacity_mt: 30000, current_stock_mt: 8200, commodities: ["Ginger", "Maize", "Groundnut"], certifications: ["AFEX", "SON"], contact_email: "bauchi@nexcom.ng", contact_phone: "+234-800-001-0002" },
  { id: "WH-LAG-001", name: "Lagos Port Cold Store", location: "Apapa, Lagos", country: "Nigeria", state: "Lagos", capacity_mt: 100000, current_stock_mt: 45000, commodities: ["Cocoa", "Cotton", "Sesame"], certifications: ["AFEX", "ISO 9001", "NAFDAC", "NPA"], contact_email: "lagos@nexcom.ng", contact_phone: "+234-800-001-0003" },
  { id: "WH-ACC-001", name: "Accra Commodity Centre", location: "Tema, Accra", country: "Ghana", capacity_mt: 40000, current_stock_mt: 18000, commodities: ["Cocoa", "Maize", "Soya"], certifications: ["COCOBOD", "GSA"], contact_email: "accra@nexcom.gh", contact_phone: "+233-800-001-0001" },
  { id: "WH-NBO-001", name: "Nairobi Grain Hub", location: "Nairobi", country: "Kenya", capacity_mt: 35000, current_stock_mt: 9800, commodities: ["Coffee", "Maize", "Wheat"], certifications: ["KEBS", "ISO 9001"], contact_email: "nairobi@nexcom.ke", contact_phone: "+254-800-001-0001" },
];

const MOCK_EWRS: EWR[] = [
  { id: "ewr-001", receipt_number: "EWR-2026-KAD-00847", depositor_id: "dep-001", warehouse_id: "WH-KAD-001", commodity: "Ginger", grade_code: "NG-SPLIT-DRY-G1", quantity_mt: 9.75, value_ngn: 8287500, status: "ACTIVE", issued_at: "2026-02-15T09:00:00Z", expires_at: "2026-08-15T09:00:00Z" },
  { id: "ewr-002", receipt_number: "EWR-2026-KAD-00848", depositor_id: "dep-001", warehouse_id: "WH-KAD-001", commodity: "Ginger", grade_code: "NG-SPLIT-DRY-G2", quantity_mt: 5.20, value_ngn: 3900000, status: "ACTIVE", issued_at: "2026-02-20T10:30:00Z", expires_at: "2026-08-20T10:30:00Z" },
  { id: "ewr-003", receipt_number: "EWR-2026-BAU-00312", depositor_id: "dep-001", warehouse_id: "WH-BAU-001", commodity: "Maize", grade_code: "NG-MAIZE-G1", quantity_mt: 25.0, value_ngn: 4625000, status: "TRADED", issued_at: "2026-01-10T08:00:00Z", expires_at: "2026-07-10T08:00:00Z" },
];

// ─── API Functions ─────────────────────────────────────────────────────────────

// Matching Engine
export const matchingEngineApi = {
  async health(): Promise<{ status: string; role: string; accepting_orders: boolean }> {
    return req(`${ME_BASE}/health`);
  },

  async getCommodities(): Promise<Commodity[]> {
    try {
      const data = await req<{ commodities: Commodity[] }>(`${ME_BASE}/api/v1/commodities`);
      return data.commodities ?? MOCK_COMMODITIES;
    } catch {
      return MOCK_COMMODITIES;
    }
  },

  async getOrderBook(symbol: string): Promise<OrderBook> {
    try {
      return await req<OrderBook>(`${ME_BASE}/api/v1/orderbook/${symbol}`);
    } catch {
      // Generate mock order book
      const mid = MOCK_COMMODITIES.find(c => c.symbol === symbol)?.last_price ?? 100000;
      const bids: [number, number][] = Array.from({ length: 8 }, (_, i) => [mid * (1 - (i + 1) * 0.001), Math.random() * 10 + 1]);
      const asks: [number, number][] = Array.from({ length: 8 }, (_, i) => [mid * (1 + (i + 1) * 0.001), Math.random() * 10 + 1]);
      return { symbol, bids, asks, timestamp: new Date().toISOString() };
    }
  },

  async submitOrder(order: {
    symbol: string;
    side: "BUY" | "SELL";
    order_type: "LIMIT" | "MARKET";
    price?: number;
    quantity: number;
    account_id: string;
    client_order_id?: string;
  }): Promise<{ data: { order: Order } }> {
    return req(`${ME_BASE}/api/v1/orders`, {
      method: "POST",
      body: JSON.stringify(order),
    });
  },

  async cancelOrder(orderId: string): Promise<void> {
    return req(`${ME_BASE}/api/v1/orders/${orderId}/cancel`, { method: "POST" });
  },

  async getOrders(accountId: string): Promise<Order[]> {
    try {
      const data = await req<{ orders: Order[] }>(`${ME_BASE}/api/v1/orders?account_id=${accountId}`);
      return data.orders ?? [];
    } catch {
      return [];
    }
  },
};

// Settlement Service
export const settlementApi = {
  async health(): Promise<{ status: string }> {
    try {
      return await req(`${SETTLE_BASE}/v1/health`);
    } catch {
      return { status: "unknown" };
    }
  },

  async getStats(): Promise<SettlementStats> {
    try {
      return await req(`${SETTLE_BASE}/v1/stats`);
    } catch {
      return { total_settlements: 1247, total_volume_usd: 4820000, avg_latency_ms: 3.2, success_rate: 99.97 };
    }
  },

  async createAccount(accountId: string, ledger: number = 1): Promise<{ account_id: string }> {
    return req(`${SETTLE_BASE}/v1/accounts`, {
      method: "POST",
      body: JSON.stringify({ account_id: accountId, ledger, initial_balance: 0 }),
    });
  },
};

// Warehouse Integration Service
export const warehouseApi = {
  async health(): Promise<{ status: string }> {
    try {
      return await req(`${WH_BASE}/health`);
    } catch {
      return { status: "unknown" };
    }
  },

  async getWarehouses(commodity?: string): Promise<Warehouse[]> {
    try {
      const url = commodity ? `${WH_BASE}/api/v1/warehouses?commodity=${commodity}` : `${WH_BASE}/api/v1/warehouses`;
      const data = await req<{ warehouses: Warehouse[] }>(url);
      return data.warehouses ?? MOCK_WAREHOUSES;
    } catch {
      return commodity ? MOCK_WAREHOUSES.filter(w => w.commodities.some(c => c.toLowerCase().includes(commodity.toLowerCase()))) : MOCK_WAREHOUSES;
    }
  },

  async getGradeSpecs(commodity?: string): Promise<GradeSpec[]> {
    try {
      const url = commodity ? `${WH_BASE}/api/v1/grades?commodity=${commodity}` : `${WH_BASE}/api/v1/grades`;
      const data = await req<{ grades: GradeSpec[] }>(url);
      return data.grades ?? [];
    } catch {
      return [
        { code: "NG-SPLIT-DRY-G1", commodity: "Ginger", name: "Premium Export Grade", description: "Split dried, export quality", moisture_max_pct: 10, impurity_max_pct: 0.5, min_price_per_mt: 800000, max_price_per_mt: 950000, standard: "ASTA" },
        { code: "NG-SPLIT-DRY-G2", commodity: "Ginger", name: "Standard Domestic Grade", description: "Split dried, domestic quality", moisture_max_pct: 12, impurity_max_pct: 1.0, min_price_per_mt: 700000, max_price_per_mt: 800000, standard: "SON" },
        { code: "NG-MAIZE-G1", commodity: "Maize", name: "Grade 1 White Maize", description: "Premium white maize", moisture_max_pct: 14, impurity_max_pct: 1.0, min_price_per_mt: 170000, max_price_per_mt: 200000, standard: "SON" },
        { code: "GH-COCOA-G1", commodity: "Cocoa", name: "Grade 1 Fermented", description: "Well fermented, dried cocoa", moisture_max_pct: 7.5, impurity_max_pct: 0.5, min_price_per_mt: 3000, max_price_per_mt: 3500, standard: "COCOBOD" },
      ];
    }
  },

  async registerDepositor(data: {
    name: string;
    phone: string;
    email?: string;
    nin?: string;
    bvn?: string;
    account_type: "FARMER" | "TRADER" | "PROCESSOR";
  }): Promise<{ depositor: Depositor }> {
    return req(`${WH_BASE}/api/v1/depositors`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async getDepositor(id: string): Promise<Depositor> {
    return req(`${WH_BASE}/api/v1/depositors/${id}`);
  },

  async submitDeposit(data: {
    depositor_id: string;
    warehouse_id: string;
    commodity: string;
    estimated_quantity_mt: number;
    grade_code?: string;
  }): Promise<{ deposit: DepositRequest }> {
    return req(`${WH_BASE}/api/v1/deposits`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async getDeposits(depositorId?: string): Promise<DepositRequest[]> {
    try {
      const url = depositorId ? `${WH_BASE}/api/v1/deposits?depositor_id=${depositorId}` : `${WH_BASE}/api/v1/deposits`;
      const data = await req<{ deposits: DepositRequest[] }>(url);
      return data.deposits ?? [];
    } catch {
      return [];
    }
  },

  async updateDepositStatus(depositId: string, status: string, extra?: Record<string, string>): Promise<void> {
    return req(`${WH_BASE}/api/v1/deposits/${depositId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, ...extra }),
    });
  },

  async submitGrading(data: {
    deposit_id: string;
    inspector_name: string;
    grade_code: string;
    accepted_quantity_mt: number;
    rejected_quantity_mt: number;
    moisture_pct: number;
    impurity_pct: number;
    notes?: string;
  }): Promise<{ inspection: GradingInspection }> {
    return req(`${WH_BASE}/api/v1/grading`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async issueEWR(data: {
    deposit_id: string;
    depositor_id: string;
    warehouse_id: string;
    commodity: string;
    grade_code: string;
    quantity_mt: number;
    price_per_mt: number;
  }): Promise<{ ewr: EWR }> {
    return req(`${WH_BASE}/api/v1/ewrs`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async getEWRs(depositorId?: string): Promise<EWR[]> {
    try {
      const url = depositorId ? `${WH_BASE}/api/v1/ewrs?depositor_id=${depositorId}` : `${WH_BASE}/api/v1/ewrs`;
      const data = await req<{ ewrs: EWR[] }>(url);
      return data.ewrs ?? MOCK_EWRS;
    } catch {
      return MOCK_EWRS;
    }
  },

  async transferEWR(ewrId: string, newOwnerId: string): Promise<void> {
    return req(`${WH_BASE}/api/v1/ewrs/${ewrId}/transfer`, {
      method: "POST",
      body: JSON.stringify({ new_owner_id: newOwnerId }),
    });
  },

  async createDeliveryOrder(data: {
    ewr_id: string;
    buyer_id: string;
    warehouse_id: string;
    quantity_mt: number;
    scheduled_date?: string;
  }): Promise<{ delivery: DeliveryOrder }> {
    return req(`${WH_BASE}/api/v1/delivery`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async getDeliveries(buyerId?: string): Promise<DeliveryOrder[]> {
    try {
      const url = buyerId ? `${WH_BASE}/api/v1/delivery?buyer_id=${buyerId}` : `${WH_BASE}/api/v1/delivery`;
      const data = await req<{ deliveries: DeliveryOrder[] }>(url);
      return data.deliveries ?? [];
    } catch {
      return [];
    }
  },

  async getWarehouseStock(warehouseId: string): Promise<{ warehouse_id: string; total_stock_mt: number; commodities: Record<string, number> }> {
    try {
      return await req(`${WH_BASE}/api/v1/warehouses/${warehouseId}/stock`);
    } catch {
      return { warehouse_id: warehouseId, total_stock_mt: 12450, commodities: { Ginger: 8200, Sesame: 2100, Soya: 2150 } };
    }
  },
};

// ─── Utility helpers ──────────────────────────────────────────────────────────

export function formatCurrency(amount: number, currency = "NGN"): string {
  if (currency === "NGN") {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}

export function formatNumber(n: number, decimals = 2): string {
  return new Intl.NumberFormat("en", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function getCategoryColor(category: string): string {
  const map: Record<string, string> = {
    grain: "grain", spice: "spice", oilseed: "oilseed", pulse: "pulse",
    root: "root", softcommodity: "softcommodity", livestock: "livestock",
    energy: "energy", metal: "metal",
  };
  return map[category.toLowerCase()] ?? "grain";
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: "text-green-700 bg-green-100",
    NEW: "text-blue-700 bg-blue-100",
    FILLED: "text-green-700 bg-green-100",
    PARTIALLY_FILLED: "text-amber-700 bg-amber-100",
    CANCELLED: "text-gray-600 bg-gray-100",
    TRADED: "text-purple-700 bg-purple-100",
    DELIVERED: "text-teal-700 bg-teal-100",
    EXPIRED: "text-red-700 bg-red-100",
    PENDING: "text-amber-700 bg-amber-100",
    APPROVED: "text-green-700 bg-green-100",
    REJECTED: "text-red-700 bg-red-100",
    IN_TRANSIT: "text-blue-700 bg-blue-100",
    GRADED: "text-indigo-700 bg-indigo-100",
    EWR_ISSUED: "text-green-700 bg-green-100",
    COLLECTED: "text-blue-700 bg-blue-100",
    RECEIVED: "text-indigo-700 bg-indigo-100",
  };
  return map[status] ?? "text-gray-600 bg-gray-100";
}
