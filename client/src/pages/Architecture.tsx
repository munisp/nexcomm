/**
 * NEXCOM Architecture & System Design Page
 * ─────────────────────────────────────────────────────────────────────────────
 * Displays the platform's inter-service communication topology, idempotency
 * design, gRPC service definitions, and multi-currency/language capabilities.
 * Accessible to admin users only.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import {
  Network,
  Shield,
  Globe,
  Cpu,
  Database,
  Zap,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  Server,
  Code2,
  Lock,
} from "lucide-react";

// ─── gRPC Service definitions ─────────────────────────────────────────────────
const GRPC_SERVICES = [
  {
    name: "MatchingEngine",
    port: 50051,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/30",
    methods: [
      { name: "SubmitOrder", type: "Unary", desc: "Submit order with idempotency key; returns fill details" },
      { name: "CancelOrder", type: "Unary", desc: "Cancel an open order by ID" },
      { name: "GetOrderBook", type: "Unary", desc: "Fetch current bid/ask depth for a symbol" },
      { name: "StreamOrderBook", type: "Server Stream", desc: "Live order book updates pushed to client" },
      { name: "GetOrderStatus", type: "Unary", desc: "Get current status and fill details for an order" },
    ],
  },
  {
    name: "SettlementService",
    port: 50051,
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/30",
    methods: [
      { name: "InitiateSettlement", type: "Unary", desc: "Create T+2 settlement record for a filled order" },
      { name: "UpdateSettlementStatus", type: "Unary", desc: "Update settlement to MATCHED/SETTLED/FAILED" },
      { name: "GetSettlement", type: "Unary", desc: "Fetch settlement details by ID" },
      { name: "ListSettlements", type: "Unary", desc: "List settlements for a user with status filter" },
      { name: "BatchSettle", type: "Unary", desc: "Clearing house: settle all pending T+2 records" },
    ],
  },
  {
    name: "PriceAlertService",
    port: 50051,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/30",
    methods: [
      { name: "CreateAlert", type: "Unary", desc: "Create a price alert for a symbol/direction/target" },
      { name: "DeleteAlert", type: "Unary", desc: "Remove a price alert" },
      { name: "ListAlerts", type: "Unary", desc: "List all alerts for the authenticated user" },
      { name: "StreamTriggeredAlerts", type: "Server Stream", desc: "Real-time stream of triggered alerts" },
    ],
  },
];

// ─── Idempotency audit results ────────────────────────────────────────────────
const IDEMPOTENCY_AUDIT = [
  {
    operation: "orders.create",
    status: "protected",
    mechanism: "clientOrderId UUID + DB unique constraint on (userId, clientOrderId)",
    detail: "Frontend generates crypto.randomUUID() per submission. gRPC MatchingEngine checks for existing order before inserting.",
  },
  {
    operation: "deposits.create",
    status: "protected",
    mechanism: "clientOrderId UUID passed in mutation input",
    detail: "Deposit requests include a client-generated UUID. Duplicate submissions return the existing record.",
  },
  {
    operation: "receipts.create",
    status: "protected",
    mechanism: "clientOrderId UUID passed in mutation input",
    detail: "Warehouse receipt creation includes a client-generated UUID for deduplication.",
  },
  {
    operation: "settlements.create",
    status: "protected",
    mechanism: "orderId FK unique per settlement + gRPC idempotency check",
    detail: "Each order can only have one settlement record. Duplicate initiation returns the existing settlement.",
  },
  {
    operation: "priceAlerts.create",
    status: "partial",
    mechanism: "No deduplication — user can create duplicate alerts",
    detail: "Intentional: users may want multiple alerts on the same symbol at different prices. UI prevents exact duplicates via client-side check.",
  },
  {
    operation: "auth.logout",
    status: "safe",
    mechanism: "Cookie deletion is naturally idempotent",
    detail: "Logging out multiple times has no side effects — the session cookie is simply cleared.",
  },
  {
    operation: "profile.update",
    status: "safe",
    mechanism: "UPDATE with same values is a no-op",
    detail: "Profile updates are PUT-style operations — applying the same update twice produces the same result.",
  },
  {
    operation: "apiKeys.revoke",
    status: "safe",
    mechanism: "Revoking an already-revoked key is a no-op",
    detail: "The revoke mutation sets is_active=false. Calling it again on an already-revoked key has no effect.",
  },
];

// ─── Supported currencies ─────────────────────────────────────────────────────
const CURRENCIES = [
  { code: "NGN", name: "Nigerian Naira", symbol: "₦", default: true },
  { code: "USD", name: "US Dollar", symbol: "$", default: false },
  { code: "EUR", name: "Euro", symbol: "€", default: false },
  { code: "GBP", name: "British Pound", symbol: "£", default: false },
  { code: "XOF", name: "CFA Franc BCEAO", symbol: "CFA", default: false },
  { code: "GHS", name: "Ghanaian Cedi", symbol: "₵", default: false },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", default: false },
  { code: "ZAR", name: "South African Rand", symbol: "R", default: false },
];

// ─── Supported languages ──────────────────────────────────────────────────────
const LANGUAGES = [
  { code: "en", name: "English", native: "English", coverage: 100 },
  { code: "yo", name: "Yoruba", native: "Yorùbá", coverage: 85 },
  { code: "ig", name: "Igbo", native: "Igbo", coverage: 85 },
  { code: "ha", name: "Hausa", native: "Hausa", coverage: 85 },
  { code: "pcm", name: "Nigerian Pidgin", native: "Naija Pidgin", coverage: 90 },
];

export default function Architecture() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Network className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">System Architecture</h1>
          <p className="text-sm text-muted-foreground">
            NEXCOM Exchange Platform — Inter-service communication, idempotency design, and capabilities
          </p>
        </div>
      </div>

      {/* Service topology diagram */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4 text-primary" />
            Service Topology
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-center justify-center gap-4 py-4">
            {/* Browser */}
            <div className="flex flex-col items-center gap-1">
              <div className="p-3 rounded-xl border bg-card text-center w-36">
                <Globe className="h-5 w-5 mx-auto mb-1 text-blue-400" />
                <div className="text-xs font-semibold">Browser / PWA</div>
                <div className="text-[10px] text-muted-foreground">React 19 + Vite</div>
              </div>
            </div>

            <ArrowRight className="h-4 w-4 text-muted-foreground rotate-0 md:rotate-0 rotate-90" />

            {/* tRPC / Express */}
            <div className="flex flex-col items-center gap-1">
              <div className="p-3 rounded-xl border bg-card text-center w-40">
                <Server className="h-5 w-5 mx-auto mb-1 text-emerald-400" />
                <div className="text-xs font-semibold">Express + tRPC</div>
                <div className="text-[10px] text-muted-foreground">HTTP :3000 · WS :3000</div>
                <Badge variant="outline" className="text-[9px] mt-1">OAuth · REST · WS</Badge>
              </div>
            </div>

            <ArrowRight className="h-4 w-4 text-muted-foreground" />

            {/* gRPC server */}
            <div className="flex flex-col items-center gap-1">
              <div className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/5 text-center w-44">
                <Zap className="h-5 w-5 mx-auto mb-1 text-amber-400" />
                <div className="text-xs font-semibold">gRPC Services</div>
                <div className="text-[10px] text-muted-foreground">localhost:50051</div>
                <div className="text-[9px] text-amber-400 mt-1">
                  MatchingEngine · Settlement · Alerts
                </div>
              </div>
            </div>

            <ArrowRight className="h-4 w-4 text-muted-foreground" />

            {/* Database */}
            <div className="flex flex-col items-center gap-1">
              <div className="p-3 rounded-xl border bg-card text-center w-36">
                <Database className="h-5 w-5 mx-auto mb-1 text-purple-400" />
                <div className="text-xs font-semibold">PostgreSQL</div>
                <div className="text-[10px] text-muted-foreground">14 tables · Drizzle ORM</div>
              </div>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-muted/30">
              <div className="font-semibold mb-1 flex items-center gap-1">
                <Code2 className="h-3 w-3" /> Browser → tRPC
              </div>
              <p className="text-muted-foreground">
                All client-server communication uses tRPC over HTTP/JSON with superjson serialisation.
                Type safety is end-to-end from database row to React component.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <div className="font-semibold mb-1 flex items-center gap-1">
                <Zap className="h-3 w-3" /> tRPC → gRPC
              </div>
              <p className="text-muted-foreground">
                tRPC procedures delegate order matching, settlement, and alert management to gRPC
                services via the grpcClient. In production, each gRPC service is independently deployable.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <div className="font-semibold mb-1 flex items-center gap-1">
                <Database className="h-3 w-3" /> gRPC → PostgreSQL
              </div>
              <p className="text-muted-foreground">
                gRPC services use Drizzle ORM with the shared schema. The in-memory order book
                provides sub-millisecond matching; PostgreSQL stores the persistent record.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="grpc">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="grpc">gRPC Services</TabsTrigger>
          <TabsTrigger value="idempotency">Idempotency</TabsTrigger>
          <TabsTrigger value="currency">Multi-Currency</TabsTrigger>
          <TabsTrigger value="language">Multi-Language</TabsTrigger>
        </TabsList>

        {/* ── gRPC Services Tab ──────────────────────────────────────────────── */}
        <TabsContent value="grpc" className="space-y-4 mt-4">
          {GRPC_SERVICES.map(svc => (
            <Card key={svc.name} className={`border ${svc.bg}`}>
              <CardHeader className="pb-2">
                <CardTitle className={`text-sm flex items-center gap-2 ${svc.color}`}>
                  <Zap className="h-4 w-4" />
                  {svc.name}
                  <Badge variant="outline" className="text-[10px] ml-auto">
                    port {svc.port}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {svc.methods.map(m => (
                    <div key={m.name} className="flex items-start gap-3 text-xs">
                      <Badge
                        variant="outline"
                        className={`text-[9px] shrink-0 ${
                          m.type === "Server Stream"
                            ? "border-amber-500/50 text-amber-400"
                            : "border-muted-foreground/30"
                        }`}
                      >
                        {m.type}
                      </Badge>
                      <div>
                        <span className="font-mono font-semibold">{m.name}</span>
                        <span className="text-muted-foreground ml-2">{m.desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Code2 className="h-4 w-4 text-primary" />
                Proto File Location
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-xs bg-muted/40 rounded p-3 space-y-1">
                <div className="text-muted-foreground"># Service definitions</div>
                <div>proto/nexcom.proto</div>
                <div className="text-muted-foreground mt-2"># Server implementation</div>
                <div>server/grpc/server.ts</div>
                <div className="text-muted-foreground mt-2"># Client stubs (used by tRPC procedures)</div>
                <div>server/grpc/client.ts</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Idempotency Tab ────────────────────────────────────────────────── */}
        <TabsContent value="idempotency" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary" />
                Idempotency Design
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <p>
                All state-mutating operations in NEXCOM are designed to be safe to retry.
                The primary mechanism is a <strong className="text-foreground">clientOrderId</strong> — a UUID generated
                by the frontend before each submission. The gRPC MatchingEngine and tRPC mutations
                check for an existing record with the same <code>(userId, clientOrderId)</code> pair
                before inserting, returning the existing result if found.
              </p>
              <p>
                The database enforces this via a <strong className="text-foreground">unique constraint</strong> on
                <code> orders(user_id, client_order_id)</code>. Network retries, double-clicks,
                and browser refreshes during submission cannot create duplicate orders.
              </p>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {IDEMPOTENCY_AUDIT.map(item => (
              <Card key={item.operation}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-start gap-3">
                    {item.status === "protected" ? (
                      <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : item.status === "safe" ? (
                      <CheckCircle className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold">{item.operation}</span>
                        <Badge
                          variant="outline"
                          className={`text-[9px] ${
                            item.status === "protected"
                              ? "border-emerald-500/50 text-emerald-400"
                              : item.status === "safe"
                              ? "border-blue-500/50 text-blue-400"
                              : "border-amber-500/50 text-amber-400"
                          }`}
                        >
                          {item.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{item.mechanism}</div>
                      <div className="text-xs text-muted-foreground/70 mt-0.5">{item.detail}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── Multi-Currency Tab ─────────────────────────────────────────────── */}
        <TabsContent value="currency" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                Multi-Currency Support
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <p>
                All prices are stored in the database as <strong className="text-foreground">NGN (Nigerian Naira)</strong> — the
                platform's base currency. The <strong className="text-foreground">PreferencesContext</strong> applies
                a live exchange rate multiplier to convert display values to the user's selected currency.
                Exchange rates are fetched from the Manus Data API and cached for 1 hour.
              </p>
              <p>
                Users set their preferred currency in <strong className="text-foreground">Settings → Display</strong>.
                The preference is persisted to the <code>user_preferences</code> table and loaded on every session.
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {CURRENCIES.map(c => (
              <Card key={c.code} className={c.default ? "border-primary/50 bg-primary/5" : ""}>
                <CardContent className="pt-4 pb-3 text-center">
                  <div className="text-2xl font-bold text-primary">{c.symbol}</div>
                  <div className="text-xs font-semibold mt-1">{c.code}</div>
                  <div className="text-[10px] text-muted-foreground">{c.name}</div>
                  {c.default && (
                    <Badge variant="outline" className="text-[9px] mt-1 border-primary/50 text-primary">
                      Default
                    </Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── Multi-Language Tab ─────────────────────────────────────────────── */}
        <TabsContent value="language" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                Multi-Language Support
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <p>
                NEXCOM supports five languages with a custom lightweight i18n system in
                <code> client/src/lib/i18n.ts</code>. The <strong className="text-foreground">PreferencesContext</strong> provides
                a <code>t(key)</code> function to all components. Language is persisted to
                <code> user_preferences.language</code> and loaded on session start.
              </p>
              <p>
                Nigerian Pidgin (<strong className="text-foreground">Naija</strong>) is a first-class language in the system,
                reflecting the platform's commitment to accessibility for all Nigerian users regardless
                of formal education level.
              </p>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {LANGUAGES.map(lang => (
              <Card key={lang.code}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{lang.name}</span>
                        <span className="text-xs text-muted-foreground">({lang.native})</span>
                        <Badge variant="outline" className="text-[9px]">{lang.code}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-muted-foreground">{lang.coverage}% coverage</div>
                      <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${lang.coverage}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                Translation Key Sample
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-xs bg-muted/40 rounded p-3 space-y-1 overflow-x-auto">
                <div className="text-muted-foreground">// client/src/lib/i18n.ts</div>
                <div>dashboard: &#123;</div>
                <div className="pl-4">en: <span className="text-emerald-400">"Dashboard"</span>,</div>
                <div className="pl-4">yo: <span className="text-emerald-400">"Pẹpẹ Iṣakoso"</span>,</div>
                <div className="pl-4">ig: <span className="text-emerald-400">"Ọchịchọ"</span>,</div>
                <div className="pl-4">ha: <span className="text-emerald-400">"Allon Sarrafa"</span>,</div>
                <div className="pl-4">pcm: <span className="text-emerald-400">"Control Board"</span>,</div>
                <div>&#125;</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
