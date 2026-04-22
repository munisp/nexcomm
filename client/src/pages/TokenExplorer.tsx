/**
 * TokenExplorer.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Commodity Token Explorer — browse all on-chain commodity tokens, view
 * full provenance history (Hyperledger GetHistory / EVM event log), and
 * filter by commodity type, chain, status, or warehouse receipt.
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
import { PageSkeleton } from "@/components/PageSkeleton";
  Coins,
  History,
  Search,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Filter,
  Layers,
  Package,
  Lock,
  Unlock,
  Split,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CommodityToken {
  token_id: string;
  owner_id: string;
  commodity_type: string;
  quantity: number;
  unit: string;
  status: "ACTIVE" | "LOCKED" | "FRACTIONALIZED" | "REDEEMED";
  chain: string;
  warehouse_receipt_id?: string;
  grade_id?: string;
  contract_address?: string;
  tx_hash?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, string>;
}

interface HistoryEntry {
  tx_id: string;
  timestamp: string;
  is_delete: boolean;
  value?: Partial<CommodityToken>;
  event_type?: string;
  from_address?: string;
  to_address?: string;
  block_number?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  ACTIVE:        { label: "Active",        color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <CheckCircle2 className="w-3 h-3" /> },
  LOCKED:        { label: "Locked",        color: "bg-amber-500/15 text-amber-400 border-amber-500/30",       icon: <Lock className="w-3 h-3" /> },
  FRACTIONALIZED:{ label: "Fractionalized",color: "bg-purple-500/15 text-purple-400 border-purple-500/30",   icon: <Split className="w-3 h-3" /> },
  REDEEMED:      { label: "Redeemed",      color: "bg-slate-500/15 text-slate-400 border-slate-500/30",      icon: <Unlock className="w-3 h-3" /> },
};

const CHAIN_CONFIG: Record<string, { label: string; color: string }> = {
  hyperledger: { label: "Hyperledger Fabric", color: "bg-teal-500/15 text-teal-400 border-teal-500/30" },
  ethereum:    { label: "Ethereum",           color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  polygon:     { label: "Polygon",            color: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
  amoy:        { label: "Polygon Amoy",       color: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-slate-500/15 text-slate-400 border-slate-500/30", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function ChainBadge({ chain }: { chain: string }) {
  const cfg = CHAIN_CONFIG[chain?.toLowerCase()] ?? { label: chain, color: "bg-slate-500/15 text-slate-400 border-slate-500/30" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      <Layers className="w-3 h-3" />{cfg.label}
    </span>
  );
}

function truncate(str: string, len = 12) {
  if (!str) return "—";
  if (str.length <= len) return str;
  return `${str.slice(0, 6)}…${str.slice(-4)}`;
}

function formatTs(ts?: string) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

// ─── Token History Dialog ─────────────────────────────────────────────────────

function TokenHistoryDialog({
  token,
  onClose,
}: {
  token: CommodityToken;
  onClose: () => void;
}) {
  const { data, isLoading } = trpc.blockchain.getTokenHistory.useQuery(
    { tokenId: token.token_id },
    { retry: false }
  );

  const history: HistoryEntry[] = (data as any)?.history ?? [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl bg-slate-900 border-slate-700 text-slate-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-400">
            <History className="w-5 h-5" />
            On-Chain Provenance — {truncate(token.token_id, 20)}
          </DialogTitle>
        </DialogHeader>

        {/* Token Summary */}
        <div className="grid grid-cols-3 gap-3 p-3 bg-slate-800/60 rounded-lg border border-slate-700 text-sm">
          <div>
            <p className="text-slate-400 text-xs mb-0.5">Commodity</p>
            <p className="font-semibold text-slate-100">{token.commodity_type}</p>
          </div>
          <div>
            <p className="text-slate-400 text-xs mb-0.5">Quantity</p>
            <p className="font-semibold text-slate-100">{token.quantity} {token.unit}</p>
          </div>
          <div>
            <p className="text-slate-400 text-xs mb-0.5">Chain</p>
            <ChainBadge chain={token.chain} />
          </div>
          <div>
            <p className="text-slate-400 text-xs mb-0.5">Status</p>
            <StatusBadge status={token.status} />
          </div>
          <div>
            <p className="text-slate-400 text-xs mb-0.5">Warehouse Receipt</p>
            <p className="font-mono text-xs text-slate-300">{token.warehouse_receipt_id ?? "—"}</p>
          </div>
          <div>
            <p className="text-slate-400 text-xs mb-0.5">Contract / Peer</p>
            <p className="font-mono text-xs text-slate-300">{truncate(token.contract_address ?? "", 16)}</p>
          </div>
        </div>

        {/* History Timeline */}
        <div className="mt-2">
          <h3 className="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
            <History className="w-4 h-4 text-amber-400" />
            Transaction History ({history.length} events)
          </h3>

          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading on-chain history…
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-slate-500 gap-2">
              <AlertCircle className="w-8 h-8" />
              <p className="text-sm">No history available — blockchain service may be offline</p>
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {history.map((entry, idx) => (
                <div
                  key={entry.tx_id ?? idx}
                  className="flex gap-3 p-3 bg-slate-800/50 rounded-lg border border-slate-700/60 text-sm"
                >
                  {/* Timeline dot */}
                  <div className="flex flex-col items-center">
                    <div className={`w-3 h-3 rounded-full mt-0.5 flex-shrink-0 ${
                      entry.is_delete ? "bg-red-500" : idx === 0 ? "bg-emerald-500" : "bg-amber-500"
                    }`} />
                    {idx < history.length - 1 && (
                      <div className="w-px flex-1 bg-slate-700 mt-1" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-medium text-slate-200">
                        {entry.event_type ?? (entry.is_delete ? "DELETE" : idx === 0 ? "MINT" : "UPDATE")}
                      </span>
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" />{formatTs(entry.timestamp)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
                      <span>Tx: <span className="font-mono text-slate-300">{truncate(entry.tx_id, 16)}</span></span>
                      {entry.block_number && <span>Block: <span className="text-slate-300">{entry.block_number}</span></span>}
                      {entry.from_address && <span>From: <span className="font-mono text-slate-300">{truncate(entry.from_address, 14)}</span></span>}
                      {entry.to_address && <span>To: <span className="font-mono text-slate-300">{truncate(entry.to_address, 14)}</span></span>}
                      {entry.value?.status && <span>Status: <StatusBadge status={entry.value.status} /></span>}
                      {entry.value?.quantity !== undefined && (
                        <span>Qty: <span className="text-slate-300">{entry.value.quantity}</span></span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TokenExplorer() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterChain, setFilterChain] = useState<string>("all");
  const [filterCommodity, setFilterCommodity] = useState<string>("");
  const [selectedToken, setSelectedToken] = useState<CommodityToken | null>(null);

  const LIMIT = 20;

  // Build search query params
  const searchInput = useMemo(() => ({
    commodityType: filterCommodity || undefined,
    status: (filterStatus !== "all" ? filterStatus : undefined) as any,
    chain: filterChain !== "all" ? filterChain : undefined,
    page,
    limit: LIMIT,
  }), [filterCommodity, filterStatus, filterChain, page]);

  const { data: searchData, isLoading: searchLoading, refetch } = trpc.blockchain.searchTokens.useQuery(
    searchInput,
    { retry: false }
  );

  const { data: listData, isLoading: listLoading } = trpc.blockchain.listTokens.useQuery(
    { page, limit: LIMIT },
    { enabled: !filterCommodity && filterStatus === "all" && filterChain === "all", retry: false }
  );

  const isFiltering = !!(filterCommodity || filterStatus !== "all" || filterChain !== "all");
  const rawData = isFiltering ? searchData : listData;
  const tokens: CommodityToken[] = (rawData as any)?.tokens ?? [];
  const total: number = (rawData as any)?.total ?? 0;
  const isLoading = isFiltering ? searchLoading : listLoading;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  // Client-side text search on top of server results
  const filteredTokens = useMemo(() => {
    if (!search.trim()) return tokens;
    const q = search.toLowerCase();
    return tokens.filter(t =>
      t.token_id?.toLowerCase().includes(q) ||
      t.commodity_type?.toLowerCase().includes(q) ||
      t.owner_id?.toLowerCase().includes(q) ||
      t.warehouse_receipt_id?.toLowerCase().includes(q) ||
      t.tx_hash?.toLowerCase().includes(q)
    );
  }, [tokens, search]);

  function handleFilterChange() {
    setPage(1);
  }

  if (searchLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Coins className="w-7 h-7 text-amber-400" />
              Commodity Token Explorer
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Browse all on-chain commodity tokens · view full provenance via Hyperledger GetHistory
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="border-slate-600 text-slate-300 hover:bg-slate-700"
          >
            <RefreshCw className="w-4 h-4 mr-1.5" />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 p-4 bg-slate-800/50 rounded-xl border border-slate-700">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search by token ID, commodity, owner, tx hash…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-slate-900 border-slate-600 text-slate-100 placeholder:text-slate-500"
            />
          </div>
          <Select value={filterCommodity || "all"} onValueChange={v => { setFilterCommodity(v === "all" ? "" : v); handleFilterChange(); }}>
            <SelectTrigger className="w-44 bg-slate-900 border-slate-600 text-slate-100">
              <Package className="w-4 h-4 mr-1.5 text-slate-400" />
              <SelectValue placeholder="Commodity" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-slate-100">
              <SelectItem value="all">All Commodities</SelectItem>
              <SelectItem value="MAIZE">Maize</SelectItem>
              <SelectItem value="COCOA">Cocoa</SelectItem>
              <SelectItem value="COFFEE">Coffee</SelectItem>
              <SelectItem value="SOYBEAN">Soybean</SelectItem>
              <SelectItem value="WHEAT">Wheat</SelectItem>
              <SelectItem value="RICE">Rice</SelectItem>
              <SelectItem value="COTTON">Cotton</SelectItem>
              <SelectItem value="CRUDE_OIL">Crude Oil</SelectItem>
              <SelectItem value="GOLD">Gold</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={v => { setFilterStatus(v); handleFilterChange(); }}>
            <SelectTrigger className="w-40 bg-slate-900 border-slate-600 text-slate-100">
              <Filter className="w-4 h-4 mr-1.5 text-slate-400" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-slate-100">
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="LOCKED">Locked</SelectItem>
              <SelectItem value="FRACTIONALIZED">Fractionalized</SelectItem>
              <SelectItem value="REDEEMED">Redeemed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterChain} onValueChange={v => { setFilterChain(v); handleFilterChange(); }}>
            <SelectTrigger className="w-44 bg-slate-900 border-slate-600 text-slate-100">
              <Layers className="w-4 h-4 mr-1.5 text-slate-400" />
              <SelectValue placeholder="Chain" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-slate-100">
              <SelectItem value="all">All Chains</SelectItem>
              <SelectItem value="hyperledger">Hyperledger Fabric</SelectItem>
              <SelectItem value="ethereum">Ethereum</SelectItem>
              <SelectItem value="polygon">Polygon</SelectItem>
              <SelectItem value="amoy">Polygon Amoy</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total Tokens", value: total, icon: <Coins className="w-4 h-4 text-amber-400" /> },
            { label: "Active", value: tokens.filter(t => t.status === "ACTIVE").length, icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" /> },
            { label: "Locked", value: tokens.filter(t => t.status === "LOCKED").length, icon: <Lock className="w-4 h-4 text-amber-400" /> },
            { label: "Fractionalized", value: tokens.filter(t => t.status === "FRACTIONALIZED").length, icon: <Split className="w-4 h-4 text-purple-400" /> },
          ].map(stat => (
            <div key={stat.label} className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg border border-slate-700">
              {stat.icon}
              <div>
                <p className="text-xl font-bold text-slate-100">{stat.value}</p>
                <p className="text-xs text-slate-400">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Token Table */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700 hover:bg-transparent">
                <TableHead className="text-slate-400">Token ID</TableHead>
                <TableHead className="text-slate-400">Commodity</TableHead>
                <TableHead className="text-slate-400">Quantity</TableHead>
                <TableHead className="text-slate-400">Owner</TableHead>
                <TableHead className="text-slate-400">Chain</TableHead>
                <TableHead className="text-slate-400">Status</TableHead>
                <TableHead className="text-slate-400">Warehouse Receipt</TableHead>
                <TableHead className="text-slate-400">Minted</TableHead>
                <TableHead className="text-slate-400 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-slate-700">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <TableCell key={j}>
                        <div className="h-4 bg-slate-700/60 rounded animate-pulse" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredTokens.length === 0 ? (
                <TableRow className="border-slate-700">
                  <TableCell colSpan={9} className="text-center py-12 text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <Coins className="w-10 h-10 text-slate-600" />
                      <p className="font-medium">No tokens found</p>
                      <p className="text-xs">
                        {(rawData as any)?.error
                          ? "Blockchain service is offline — tokens will appear when the service is running"
                          : "Try adjusting your filters or tokenize a commodity first"}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredTokens.map(token => (
                  <TableRow
                    key={token.token_id}
                    className="border-slate-700 hover:bg-slate-700/30 cursor-pointer"
                    onClick={() => setSelectedToken(token)}
                  >
                    <TableCell className="font-mono text-xs text-amber-400">
                      {truncate(token.token_id, 16)}
                    </TableCell>
                    <TableCell className="font-medium text-slate-200">{token.commodity_type}</TableCell>
                    <TableCell className="text-slate-300">{token.quantity} <span className="text-slate-500 text-xs">{token.unit}</span></TableCell>
                    <TableCell className="font-mono text-xs text-slate-400">{truncate(token.owner_id, 14)}</TableCell>
                    <TableCell><ChainBadge chain={token.chain} /></TableCell>
                    <TableCell><StatusBadge status={token.status} /></TableCell>
                    <TableCell className="font-mono text-xs text-slate-400">
                      {token.warehouse_receipt_id ? truncate(token.warehouse_receipt_id, 14) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{formatTs(token.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-amber-400 hover:text-amber-300 hover:bg-amber-400/10"
                        onClick={e => { e.stopPropagation(); setSelectedToken(token); }}
                      >
                        <History className="w-4 h-4 mr-1" />
                        History
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>
              Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, total)} of {total} tokens
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="px-3 py-1 bg-slate-800 rounded border border-slate-700">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Token History Dialog */}
      {selectedToken && (
        <TokenHistoryDialog
          token={selectedToken}
          onClose={() => setSelectedToken(null)}
        />
      )}
    </DashboardLayout>
  );
}
