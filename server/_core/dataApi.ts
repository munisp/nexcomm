/**
 * NEXCOM Exchange — Data API helper
 *
 * Replaces the Manus WebDevService/CallApi gRPC-web proxy with direct HTTP
 * calls to the underlying data providers.
 *
 * Currently supported API IDs:
 *   - "YahooFinance/get_stock_chart" → direct Yahoo Finance v8 chart endpoint
 *
 * Add additional providers by extending the switch statement below.
 * No Manus dependencies.
 */

export type DataApiCallOptions = {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
  formData?: Record<string, unknown>;
};

// ── Yahoo Finance direct client ────────────────────────────────────────────────

async function callYahooFinance(
  endpoint: string,
  options: DataApiCallOptions
): Promise<unknown> {
  const { query = {} } = options;

  if (endpoint === "get_stock_chart") {
    const symbol = encodeURIComponent(String(query.symbol ?? ""));
    const params = new URLSearchParams();
    if (query.region) params.set("region", String(query.region));
    if (query.interval) params.set("interval", String(query.interval));
    if (query.range) params.set("range", String(query.range));

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?${params.toString()}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; nexcom-exchange/1.0)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      throw new Error(`Yahoo Finance request failed: ${resp.status} ${resp.statusText}`);
    }
    return resp.json();
  }

  throw new Error(`Unsupported Yahoo Finance endpoint: ${endpoint}`);
}

// ── Router ─────────────────────────────────────────────────────────────────────

export async function callDataApi(
  apiId: string,
  options: DataApiCallOptions = {}
): Promise<unknown> {
  const [provider, ...rest] = apiId.split("/");
  const endpoint = rest.join("/");

  switch (provider) {
    case "YahooFinance":
      return callYahooFinance(endpoint, options);

    default:
      throw new Error(
        `Unsupported data API provider: "${provider}". ` +
        `Add a case for it in server/_core/dataApi.ts.`
      );
  }
}
