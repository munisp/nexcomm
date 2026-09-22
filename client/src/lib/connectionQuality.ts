/**
 * NEXCOM Exchange — Connection quality detection (OFFLINE-RES)
 * ─────────────────────────────────────────────────────────────────────────────
 * Classifies the device's network into "offline" | "slow" | "fast" using the
 * Network Information API (navigator.connection: effectiveType / saveData /
 * downlink) plus online/offline window events. Built for rural-Nigeria 2G/3G:
 *
 *   - "offline" — navigator.onLine === false
 *   - "slow"    — effectiveType is "slow-2g" or "2g", OR Save-Data is on, OR
 *                 downlink <= 0.5 Mbps
 *   - "fast"    — everything else (3g/4g without Save-Data)
 *
 * navigator.connection is Chromium-only; on browsers without it we conservatively
 * report "fast" when online (existing behaviour is preserved — no fabricated
 * throttling). Fail-closed: when online state is unknown we trust events.
 *
 * Use the hook inside React components (re-renders on change) and the
 * non-hook getConnectionClass() snapshot inside non-React code (main.tsx
 * retry logic) where a stale-between-events read is acceptable.
 */
import { useEffect, useState } from "react";

export type ConnectionClass = "offline" | "slow" | "fast";

export interface ConnectionQuality {
  /** Coarse classification used for query tuning */
  quality: ConnectionClass;
  isOnline: boolean;
  /** Save-Data header preference — when true, eliminate all non-essential traffic */
  saveData: boolean;
  /** e.g. "slow-2g" | "2g" | "3g" | "4g" — undefined when unsupported */
  effectiveType: string | undefined;
  /** Estimated Mbps downlink — undefined when unsupported */
  downlink: number | undefined;
}

interface NetworkInformationLike {
  effectiveType?: string;
  saveData?: boolean;
  downlink?: number;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

function getConnection(): NetworkInformationLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
}

const SLOW_EFFECTIVE_TYPES = new Set(["slow-2g", "2g"]);
const SLOW_DOWNLINK_MBPS = 0.5;

export function classifyConnection(): ConnectionClass {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  const conn = getConnection();
  if (!conn) return "fast"; // API unsupported — preserve existing behaviour
  if (conn.saveData) return "slow";
  if (conn.effectiveType && SLOW_EFFECTIVE_TYPES.has(conn.effectiveType)) return "slow";
  if (typeof conn.downlink === "number" && conn.downlink <= SLOW_DOWNLINK_MBPS) return "slow";
  return "fast";
}

/** Non-hook snapshot for use outside React (e.g. main.tsx retry policy). */
export function getConnectionClass(): ConnectionClass {
  return classifyConnection();
}

export function readConnectionQuality(): ConnectionQuality {
  const conn = getConnection();
  const isOnline = typeof navigator === "undefined" ? true : navigator.onLine;
  return {
    quality: classifyConnection(),
    isOnline,
    saveData: conn?.saveData === true,
    effectiveType: conn?.effectiveType,
    downlink: conn?.downlink,
  };
}

/**
 * React hook — re-renders when online/offline fires or the Network
 * Information API reports a change (2G ↔ 4G flaps are common in the field).
 */
export function useConnectionQuality(): ConnectionQuality {
  const [state, setState] = useState<ConnectionQuality>(() => readConnectionQuality());

  useEffect(() => {
    const update = () => setState(readConnectionQuality());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const conn = getConnection();
    conn?.addEventListener?.("change", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      conn?.removeEventListener?.("change", update);
    };
  }, []);

  return state;
}
