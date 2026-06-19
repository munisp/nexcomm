/**
 * NEXCOM Exchange — Public API Documentation
 * Self-service reference for external integrations (algorithmic trading bots, data feeds, etc.)
 * Documents the unauthenticated /api/v1/orderbook/:symbol/snapshot endpoint.
 */
import { useState } from "react";
import { Copy, Check, Code2, BookOpen, Zap, Globe, Lock, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

// ── Copy-to-clipboard button ──────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="absolute top-3 right-3 p-1.5 rounded bg-muted/60 hover:bg-slate-600/80 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ── Code block ────────────────────────────────────────────────────────────────
function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  return (
    <div className="relative rounded-lg bg-card border border-border/60 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-secondary/80 border-b border-border/60">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{language}</span>
        <CopyButton text={code} />
      </div>
      <pre className="p-4 text-sm text-muted-foreground overflow-x-auto leading-relaxed font-mono whitespace-pre">{code}</pre>
    </div>
  );
}

// ── Schema field row ──────────────────────────────────────────────────────────
function SchemaField({
  name, type, description, required = false,
}: { name: string; type: string; description: string; required?: boolean }) {
  return (
    <tr className="border-b border-border/60">
      <td className="py-2.5 pr-4 align-top">
        <code className="text-emerald-400 text-xs font-mono">{name}</code>
        {required && <span className="ml-1.5 text-[9px] font-bold text-red-400 uppercase">required</span>}
      </td>
      <td className="py-2.5 pr-4 align-top">
        <code className="text-amber-400 text-xs font-mono">{type}</code>
      </td>
      <td className="py-2.5 text-xs text-muted-foreground align-top">{description}</td>
    </tr>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 mt-0.5">
        <Icon className="w-4 h-4 text-emerald-400" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ── Instrument examples ───────────────────────────────────────────────────────
const EXAMPLE_SYMBOLS = [
  { symbol: "GINGER-NG-SPOT",  label: "Ginger (Nigeria Spot)",   class: "Commodity" },
  { symbol: "COCOA-SPOT",      label: "Cocoa (Spot)",            class: "Commodity" },
  { symbol: "SESAME-NG-SPOT",  label: "Sesame (Nigeria Spot)",   class: "Commodity" },
  { symbol: "EUR-USD",         label: "EUR/USD",                 class: "Forex" },
  { symbol: "USD-NGN",         label: "USD/NGN",                 class: "Forex" },
  { symbol: "BTC-USD",         label: "Bitcoin / USD",           class: "Digital Asset" },
  { symbol: "DANGCEM",         label: "Dangote Cement (NGX)",    class: "Equity" },
];

// ── Sample JSON response ──────────────────────────────────────────────────────
const SAMPLE_RESPONSE = `{
  "success": true,
  "data": {
    "symbol":        "GINGER-NG-SPOT",
    "depth":         5,
    "bids": [
      { "price": 1840.00, "quantity": 5000,  "total": 5000  },
      { "price": 1838.16, "quantity": 3200,  "total": 8200  },
      { "price": 1836.32, "quantity": 4800,  "total": 13000 },
      { "price": 1834.48, "quantity": 2100,  "total": 15100 },
      { "price": 1832.64, "quantity": 6700,  "total": 21800 }
    ],
    "asks": [
      { "price": 1841.84, "quantity": 4500,  "total": 4500  },
      { "price": 1843.68, "quantity": 2900,  "total": 7400  },
      { "price": 1845.52, "quantity": 3800,  "total": 11200 },
      { "price": 1847.36, "quantity": 1600,  "total": 12800 },
      { "price": 1849.20, "quantity": 5100,  "total": 17900 }
    ],
    "spread":        1.84,
    "spreadPercent": 0.10,
    "lastUpdate":    1741284000000
  }
}`;

const CURL_BASIC = `curl -X GET \\
  "https://YOUR_NEXCOM_GATEWAY/api/v1/orderbook/GINGER-NG-SPOT/snapshot" \\
  -H "Accept: application/json"`;

const CURL_WITH_DEPTH = `curl -X GET \\
  "https://YOUR_NEXCOM_GATEWAY/api/v1/orderbook/GINGER-NG-SPOT/snapshot?depth=5" \\
  -H "Accept: application/json"`;

const PYTHON_EXAMPLE = `import requests

BASE_URL = "https://YOUR_NEXCOM_GATEWAY"

def get_order_book(symbol: str, depth: int = 15) -> dict:
    """Fetch the current Level-2 order book snapshot for a given symbol."""
    url = f"{BASE_URL}/api/v1/orderbook/{symbol}/snapshot"
    resp = requests.get(url, params={"depth": depth}, timeout=5)
    resp.raise_for_status()
    return resp.json()["data"]

# Example: fetch top 5 levels for Ginger
book = get_order_book("GINGER-NG-SPOT", depth=5)
best_bid = book["bids"][0]["price"]
best_ask = book["asks"][0]["price"]
spread   = book["spread"]
print(f"Best Bid: {best_bid:,.2f}  |  Best Ask: {best_ask:,.2f}  |  Spread: {spread:,.2f}")`;

const JS_EXAMPLE = `// Node.js / Browser fetch
async function getOrderBook(symbol, depth = 15) {
  const url = \`https://YOUR_NEXCOM_GATEWAY/api/v1/orderbook/\${symbol}/snapshot?depth=\${depth}\`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
  const { data } = await res.json();
  return data;
}

// Example: calculate mid-price
const book = await getOrderBook("GINGER-NG-SPOT", 5);
const midPrice = (book.bids[0].price + book.asks[0].price) / 2;
console.log("Mid price:", midPrice.toFixed(2));`;

const ERROR_RESPONSE_400 = `{
  "success": false,
  "error": "depth must be between 1 and 50"
}`;

const ERROR_RESPONSE_200_EMPTY = `{
  "success": true,
  "data": {
    "symbol":        "UNKNOWN-SYMBOL",
    "depth":         15,
    "bids":          [],
    "asks":          [],
    "spread":        0,
    "spreadPercent": 0,
    "lastUpdate":    0
  }
}`;

// ── Version definitions ──────────────────────────────────────────────────────
const API_VERSIONS = [
  {
    id: "v1",
    label: "v1.0",
    status: "stable" as const,
    description: "Current stable release. Unauthenticated order book snapshot endpoint.",
    baseUrl: "/api/v1",
    endpoints: [
      { method: "GET", path: "/orderbook/:symbol/snapshot", description: "Level-2 order book snapshot" },
    ],
  },
  {
    id: "v2-beta",
    label: "v2.0-beta",
    status: "beta" as const,
    description: "Beta preview. Adds authenticated trade history, OHLCV candles, and WebSocket subscription management.",
    baseUrl: "/api/v2",
    endpoints: [
      { method: "GET",  path: "/orderbook/:symbol/snapshot",  description: "Level-2 order book snapshot (enhanced spread metrics)" },
      { method: "GET",  path: "/trades/:symbol/history",       description: "Recent trade history (authenticated)" },
      { method: "GET",  path: "/candles/:symbol",              description: "OHLCV candlestick data (authenticated)" },
      { method: "POST", path: "/ws/subscribe",                 description: "WebSocket subscription management (authenticated)" },
    ],
  },
] as const;

type VersionId = typeof API_VERSIONS[number]["id"];

export default function ApiDocs() {
  const [activeTab, setActiveTab] = useState<"curl" | "python" | "javascript">("curl");
  const [selectedVersion, setSelectedVersion] = useState<VersionId>("v1");
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false);

  const currentVersion = API_VERSIONS.find((v) => v.id === selectedVersion)!;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="border-b border-border bg-card/60">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <span>NEXCOM Exchange</span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-emerald-400">Developer API</span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground mb-2">Public Market Data API</h1>
              <p className="text-muted-foreground max-w-2xl">
                Unauthenticated REST endpoints for external integrations — algorithmic trading bots,
                price aggregators, and market data dashboards. No API key required.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              {/* Version selector */}
              <div className="relative">
                <button
                  onClick={() => setVersionDropdownOpen((v) => !v)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary border border-border hover:border-border text-sm text-foreground transition-colors"
                >
                  <span className="font-semibold">{currentVersion.label}</span>
                  <Badge
                    className={`text-[9px] px-1.5 py-0 ${
                      currentVersion.status === "stable"
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                        : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                    }`}
                  >
                    {currentVersion.status}
                  </Badge>
                  <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${versionDropdownOpen ? "rotate-180" : ""}`} />
                </button>
                {versionDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 w-64 rounded-lg bg-secondary border border-border shadow-xl z-50 overflow-hidden">
                    {API_VERSIONS.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => { setSelectedVersion(v.id); setVersionDropdownOpen(false); }}
                        className={`w-full text-left px-4 py-3 hover:bg-muted/60 transition-colors border-b border-border/60 last:border-0 ${
                          v.id === selectedVersion ? "bg-muted/40" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-foreground">{v.label}</span>
                          <Badge
                            className={`text-[9px] px-1.5 py-0 ${
                              v.status === "stable"
                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                                : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                            }`}
                          >
                            {v.status}
                          </Badge>
                          {v.id === selectedVersion && (
                            <Check className="w-3 h-3 text-emerald-400 ml-auto" />
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{v.description}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="w-3 h-3" />
                <span>No auth required</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-10 space-y-14">

        {/* ── Base URL ─────────────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={Globe} title="Base URL" subtitle="All endpoints are relative to the NEXCOM gateway base URL." />
          <CodeBlock code="https://YOUR_NEXCOM_GATEWAY/api/v1" language="text" />
          <p className="mt-3 text-xs text-muted-foreground">
            Replace <code className="text-amber-400">YOUR_NEXCOM_GATEWAY</code> with the hostname of your NEXCOM deployment.
            CORS is enabled for all origins on public endpoints.
          </p>
        </section>

        {/* ── Endpoint ─────────────────────────────────────────────────────── */}
        <section>
          <SectionHeader
            icon={BookOpen}
            title="GET /orderbook/:symbol/snapshot"
            subtitle="Returns the current Level-2 bid/ask ladder for a given instrument symbol."
          />

          {/* Method + path pill */}
          <div className="flex items-center gap-3 mb-6 p-4 rounded-lg bg-card border border-border/60">
            <span className="px-2.5 py-1 rounded text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">GET</span>
            <code className="text-foreground text-sm font-mono">/api/v1/orderbook/<span className="text-amber-400">:symbol</span>/snapshot</code>
            <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="w-3 h-3" />
              <span>No authentication required</span>
            </div>
          </div>

          {/* Path parameters */}
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">Path Parameters</h3>
          <div className="rounded-lg border border-border/60 overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/60 border-b border-border/60">
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Parameter</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-card/40 px-4">
                <SchemaField name="symbol" type="string" description="Instrument symbol (e.g. GINGER-NG-SPOT, EUR-USD, BTC-USD). Case-sensitive." required />
              </tbody>
            </table>
          </div>

          {/* Query parameters */}
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">Query Parameters</h3>
          <div className="rounded-lg border border-border/60 overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/60 border-b border-border/60">
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Parameter</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-card/40 px-4">
                <SchemaField
                  name="depth"
                  type="integer"
                  description="Number of price levels to return per side. Range: 1–50. Default: 15."
                />
              </tbody>
            </table>
          </div>

          {/* Response schema */}
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">Response Schema — <code className="text-emerald-400 text-xs">data</code> object</h3>
          <div className="rounded-lg border border-border/60 overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/60 border-b border-border/60">
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Field</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-card/40 px-4">
                <SchemaField name="symbol"        type="string"  description="Instrument symbol echoed from the request." />
                <SchemaField name="depth"         type="integer" description="Number of levels returned per side (may be less if the book is thin)." />
                <SchemaField name="bids"          type="Level[]" description="Bid side price levels, sorted descending by price (best bid first)." />
                <SchemaField name="asks"          type="Level[]" description="Ask side price levels, sorted ascending by price (best ask first)." />
                <SchemaField name="spread"        type="number"  description="Absolute spread between best ask and best bid (ask[0].price − bid[0].price)." />
                <SchemaField name="spreadPercent" type="number"  description="Spread expressed as a percentage of the last traded price." />
                <SchemaField name="lastUpdate"    type="integer" description="Unix timestamp in milliseconds (UTC) when the snapshot was generated." />
              </tbody>
            </table>
          </div>

          {/* Level schema */}
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">Level Object</h3>
          <div className="rounded-lg border border-border/60 overflow-hidden mb-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/60 border-b border-border/60">
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Field</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-card/40 px-4">
                <SchemaField name="price"    type="number" description="Price level in the instrument's quote currency." />
                <SchemaField name="quantity" type="number" description="Total quantity available at this price level." />
                <SchemaField name="total"    type="number" description="Cumulative quantity from the best price up to and including this level." />
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Code examples ────────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={Code2} title="Code Examples" />

          {/* Tab switcher */}
          <div className="flex gap-1 mb-4 p-1 rounded-lg bg-secondary/60 w-fit">
            {(["curl", "python", "javascript"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded text-xs font-semibold transition-colors capitalize ${
                  activeTab === tab
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "javascript" ? "JavaScript" : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {activeTab === "curl" && (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-2">Basic request (default 15 levels):</p>
                <CodeBlock code={CURL_BASIC} language="bash" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2">With custom depth (5 levels):</p>
                <CodeBlock code={CURL_WITH_DEPTH} language="bash" />
              </div>
            </div>
          )}
          {activeTab === "python" && <CodeBlock code={PYTHON_EXAMPLE} language="python" />}
          {activeTab === "javascript" && <CodeBlock code={JS_EXAMPLE} language="javascript" />}
        </section>

        {/* ── Sample response ───────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={Zap} title="Sample Response" subtitle="200 OK — depth=5 for GINGER-NG-SPOT" />
          <CodeBlock code={SAMPLE_RESPONSE} language="json" />
        </section>

        {/* ── Error responses ───────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={BookOpen} title="Error Responses" />
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/30">400</span>
                <span className="text-sm text-muted-foreground">Bad Request — invalid depth parameter</span>
              </div>
              <CodeBlock code={ERROR_RESPONSE_400} language="json" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">200</span>
                <span className="text-sm text-muted-foreground">Unknown symbol — returns empty book (not a 404)</span>
              </div>
              <CodeBlock code={ERROR_RESPONSE_200_EMPTY} language="json" />
            </div>
          </div>
        </section>

        {/* ── Supported symbols ─────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={Globe} title="Supported Symbols (Examples)" subtitle="NEXCOM supports 200+ instruments across all asset classes." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {EXAMPLE_SYMBOLS.map(({ symbol, label, class: cls }) => (
              <div key={symbol} className="flex items-center justify-between p-3 rounded-lg bg-card border border-border/60">
                <div>
                  <code className="text-emerald-400 text-xs font-mono">{symbol}</code>
                  <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                </div>
                <Badge className="text-[10px] bg-secondary text-muted-foreground border-border">{cls}</Badge>
              </div>
            ))}
          </div>
        </section>

        {/* ── Rate limits ───────────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={Zap} title="Rate Limits & Best Practices" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {[
              { label: "Max requests / second",  value: "10",   note: "per IP" },
              { label: "Max depth per request",  value: "50",   note: "price levels" },
              { label: "Snapshot freshness",      value: "~1s",  note: "refreshed on each tick" },
            ].map(({ label, value, note }) => (
              <div key={label} className="p-4 rounded-lg bg-card border border-border/60 text-center">
                <div className="text-2xl font-bold text-emerald-400 mb-1">{value}</div>
                <div className="text-xs font-semibold text-muted-foreground">{label}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{note}</div>
              </div>
            ))}
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">•</span> Cache responses locally for at least 500 ms before re-fetching to avoid rate-limit errors.</li>
            <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">•</span> For real-time streaming, prefer the WebSocket order book feed at <code className="text-amber-400 text-xs">ws://YOUR_NEXCOM_GATEWAY/ws/orderbook</code> instead of polling this endpoint.</li>
            <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">•</span> The <code className="text-amber-400 text-xs">lastUpdate</code> field is a Unix millisecond timestamp — compare it to your previous snapshot to detect stale data.</li>
            <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">•</span> Use <code className="text-amber-400 text-xs">depth=1</code> for best-bid/best-ask only (lowest latency, smallest payload).</li>
          </ul>
        </section>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div className="border-t border-border pt-8 text-center text-xs text-slate-600">
          NEXCOM Exchange — Public API v1.0 · For authenticated trading APIs, contact your NEXCOM account manager.
        </div>
      </div>
    </div>
  );
}
