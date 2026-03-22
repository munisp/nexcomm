/**
 * MojaloopHubBanner.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Persistent top-of-page banner showing real-time Mojaloop Hub operational
 * status. Polls every 30 seconds and shows ONLINE / DEGRADED / OFFLINE with
 * latency, DFSP ID, and database state. Dismissible per session.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  X,
  RefreshCw,
  Wifi,
  WifiOff,
  Clock,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type HubStatus = {
  online: boolean;
  status: string;
  dfspId: string;
  database: string;
  timestamp: string;
  version: string;
  uptime: number;
  latencyMs: number;
  mode: "live" | "standalone";
  error?: string;
};

function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function MojaloopHubBanner() {
  const [dismissed, setDismissed] = useState(false);

  const { data, isLoading, refetch, isFetching } = trpc.mojaloop.hubStatus.useQuery(undefined, {
    refetchInterval: 30_000, // Poll every 30 seconds
    retry: false,
    staleTime: 25_000,
  });

  // Don't render if dismissed
  if (dismissed) return null;

  const hub = data as HubStatus | undefined;

  // Determine banner state
  const isOnline = hub?.online === true;
  const isStandalone = hub?.mode === "standalone";
  const latencyMs = hub?.latencyMs ?? 0;
  const isDegraded = isOnline && latencyMs > 500;

  // Banner config based on state
  let bannerConfig = {
    bg: "bg-slate-800/80 border-slate-700",
    icon: <RefreshCw className="w-4 h-4 text-slate-400 animate-spin" />,
    label: "Checking Mojaloop Hub…",
    labelColor: "text-slate-400",
    dot: "bg-slate-500",
  };

  if (!isLoading) {
    if (isOnline && !isDegraded) {
      bannerConfig = {
        bg: "bg-emerald-950/60 border-emerald-800/50",
        icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
        label: "Mojaloop Hub: ONLINE",
        labelColor: "text-emerald-400",
        dot: "bg-emerald-400 animate-pulse",
      };
    } else if (isOnline && isDegraded) {
      bannerConfig = {
        bg: "bg-amber-950/60 border-amber-800/50",
        icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
        label: "Mojaloop Hub: DEGRADED",
        labelColor: "text-amber-400",
        dot: "bg-amber-400 animate-pulse",
      };
    } else {
      bannerConfig = {
        bg: "bg-red-950/60 border-red-800/50",
        icon: <XCircle className="w-4 h-4 text-red-400" />,
        label: isStandalone ? "Mojaloop Hub: OFFLINE (Standalone Mode)" : "Mojaloop Hub: OFFLINE",
        labelColor: "text-red-400",
        dot: "bg-red-500",
      };
    }
  }

  return (
    <div
      className={`flex items-center justify-between px-4 py-2 border-b text-xs ${bannerConfig.bg} transition-colors duration-500`}
      role="status"
      aria-live="polite"
    >
      {/* Left: Status */}
      <div className="flex items-center gap-3">
        {/* Live dot */}
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${bannerConfig.dot}`} />

        {/* Icon + label */}
        <div className="flex items-center gap-1.5">
          {bannerConfig.icon}
          <span className={`font-semibold ${bannerConfig.labelColor}`}>{bannerConfig.label}</span>
        </div>

        {/* Details — only when data is available */}
        {hub && !isLoading && (
          <div className="hidden sm:flex items-center gap-3 text-slate-400 ml-2">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {latencyMs}ms
            </span>
            <span className="flex items-center gap-1">
              <Database className="w-3 h-3" />
              DB: <span className={hub.database === "connected" ? "text-emerald-400" : "text-red-400"}>{hub.database}</span>
            </span>
            <span className="flex items-center gap-1">
              {isOnline ? <Wifi className="w-3 h-3 text-emerald-400" /> : <WifiOff className="w-3 h-3 text-red-400" />}
              {hub.dfspId}
            </span>
            {hub.uptime > 0 && (
              <span>Uptime: {formatUptime(hub.uptime)}</span>
            )}
            {hub.version && hub.version !== "unknown" && (
              <span>v{hub.version}</span>
            )}
            {hub.mode === "standalone" && (
              <span className="px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-400 border border-amber-700/50">
                Standalone
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right: Refresh + Dismiss */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-6 w-6 p-0 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
          title="Refresh hub status"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDismissed(true)}
          className="h-6 w-6 p-0 text-slate-500 hover:text-slate-200 hover:bg-slate-700/50"
          title="Dismiss"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}
