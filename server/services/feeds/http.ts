/**
 * http.ts — shared outbound HTTP helper for feed adapters.
 *
 * All feed traffic goes through axios with a hard 10s timeout and exactly
 * one retry (network errors and 5xx only). Never throws past the caller's
 * catch — adapters wrap this and return [] on failure.
 */
import axios, { AxiosRequestConfig } from "axios";

export const FEED_HTTP_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 750;

function isRetryable(err: unknown): boolean {
  if (axios.isAxiosError(err)) {
    if (!err.response) return true; // network/timeout/DNS
    return err.response.status >= 500;
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET JSON with 10s timeout + 1 retry. Throws on final failure. */
export async function httpGetJson<T = unknown>(url: string, config: AxiosRequestConfig = {}): Promise<T> {
  const merged: AxiosRequestConfig = {
    timeout: FEED_HTTP_TIMEOUT_MS,
    responseType: "json",
    headers: { "User-Agent": "nexcom-feeds/1.0", Accept: "application/json" },
    ...config,
  };
  try {
    const res = await axios.get<T>(url, merged);
    return res.data;
  } catch (err) {
    if (!isRetryable(err)) throw err;
    await sleep(RETRY_DELAY_MS);
    const res = await axios.get<T>(url, merged);
    return res.data;
  }
}

/** GET raw text (CSV etc.) with 10s timeout + 1 retry. Throws on final failure. */
export async function httpGetText(url: string, config: AxiosRequestConfig = {}): Promise<string> {
  const merged: AxiosRequestConfig = {
    timeout: FEED_HTTP_TIMEOUT_MS,
    responseType: "text",
    headers: { "User-Agent": "nexcom-feeds/1.0", Accept: "text/csv,text/plain,*/*" },
    ...config,
  };
  try {
    const res = await axios.get<string>(url, merged);
    return res.data;
  } catch (err) {
    if (!isRetryable(err)) throw err;
    await sleep(RETRY_DELAY_MS);
    const res = await axios.get<string>(url, merged);
    return res.data;
  }
}

/**
 * JSONPath-lite resolver: supports "$", dotted keys and [n] indexes,
 * e.g. "$.data.prices[0].value". Returns undefined when the path misses.
 * Used by the AFEX/NBS field-map env configuration.
 */
export function resolvePath(root: unknown, path: string): unknown {
  if (!path || path === "$") return root;
  let p = path.trim();
  if (p.startsWith("$")) p = p.slice(1);
  const tokens: Array<string | number> = [];
  const re = /(?:\.([A-Za-z0-9_-]+))|(?:\[(\d+)\])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : parseInt(m[2], 10));
  }
  let cur: unknown = root;
  for (const tok of tokens) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof tok === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[tok];
    } else {
      if (typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[tok];
    }
  }
  return cur;
}
