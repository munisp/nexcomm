/**
 * Shared HTTP helper for payment providers (PAY-RAILS).
 *
 * All provider HTTP calls go through `providerRequest`:
 *  - axios with a hard 10s timeout (rails must never hang the request loop)
 *  - one automatic retry on 5xx responses or network errors (no retry on 4xx)
 *  - response payloads are never logged in full (may contain account data)
 */
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";

const PROVIDER_TIMEOUT_MS = 10_000;

function isRetryable(err: AxiosError): boolean {
  if (!err.response) return true; // network error / timeout / DNS
  return err.response.status >= 500;
}

/**
 * Perform an HTTP request against a payment rail with timeout + one retry.
 * Throws the final AxiosError when both attempts fail.
 */
export async function providerRequest<T = unknown>(
  config: AxiosRequestConfig
): Promise<AxiosResponse<T>> {
  const cfg: AxiosRequestConfig = {
    timeout: PROVIDER_TIMEOUT_MS,
    ...config,
    headers: {
      "Content-Type": "application/json",
      ...(config.headers ?? {}),
    },
  };
  try {
    return await axios.request<T>(cfg);
  } catch (err) {
    const axErr = err as AxiosError;
    if (axios.isAxiosError(axErr) && isRetryable(axErr)) {
      return axios.request<T>(cfg); // single retry
    }
    throw err;
  }
}

/** Extract a safe, loggable one-line message from a provider failure. */
export function providerErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data as { message?: string } | undefined;
    // Provider error bodies sometimes echo request data — log message field only.
    const msg = data?.message ?? err.message;
    return status ? `HTTP ${status}: ${msg}` : msg;
  }
  return err instanceof Error ? err.message : String(err);
}
