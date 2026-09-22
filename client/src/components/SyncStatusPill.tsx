/**
 * SyncStatusPill (INNOV-C) — header indicator for the offline order queue.
 *
 * States: online (green, no queue) / offline (amber) / queued N (amber, count) /
 * syncing (blue, spinner). Low-saturation tokens, dark-mode aware.
 * Drop into the header: <SyncStatusPill /> (no props required).
 */
import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { watchCount } from "@/lib/offlineOrderQueue";

export function SyncStatusPill() {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [queued, setQueued] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const unwatch = watchCount(setQueued);
    const onSw = (ev: MessageEvent) => {
      const d = ev.data as { type?: string } | undefined;
      if (!d) return;
      if (d.type === "SYNC_ORDERS_START") setSyncing(true);
      if (d.type === "SYNC_ORDERS_DONE" || d.type === "ORDERS_SYNCED") setSyncing(false);
    };
    navigator.serviceWorker?.addEventListener("message", onSw);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      unwatch();
      navigator.serviceWorker?.removeEventListener("message", onSw);
    };
  }, []);

  if (syncing) {
    return (
      <Badge variant="outline" className="gap-1.5 border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Syncing…
      </Badge>
    );
  }
  if (!online || queued > 0) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "gap-1.5 border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        )}
      >
        <CloudOff className="h-3 w-3" />
        {!online ? "Offline" : ""}
        {queued > 0 ? `${online ? "" : " · "}${queued} queued` : ""}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1.5 border-emerald-200 bg-emerald-50/60 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400">
      <Wifi className="h-3 w-3" />
      Online
    </Badge>
  );
}

export default SyncStatusPill;
