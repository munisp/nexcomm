/**
 * NEXCOM Exchange — Google Maps backend helper
 *
 * Replaces the Manus forge Maps proxy with direct calls to the Google Maps
 * Platform APIs using GOOGLE_MAPS_API_KEY.
 *
 * No Manus dependencies.
 */
import { ENV } from "./env";

export type MapsRequestOptions = {
  params?: Record<string, string | number | boolean | string[]>;
};

/**
 * Make a request to a Google Maps Platform API endpoint.
 *
 * @param endpoint  e.g. "geocode/json", "directions/json", "place/nearbysearch/json"
 * @param params    Query parameters (apiKey is added automatically)
 *
 * @example
 *   const result = await makeRequest("geocode/json", { params: { address: "Lagos, Nigeria" } });
 */
export async function makeRequest<T = unknown>(
  endpoint: string,
  options: MapsRequestOptions = {}
): Promise<T> {
  const apiKey = ENV.googleMapsApiKey;
  if (!apiKey) {
    throw new Error(
      "Google Maps API key missing: set GOOGLE_MAPS_API_KEY environment variable."
    );
  }

  const url = new URL(`https://maps.googleapis.com/maps/api/${endpoint}`);
  url.searchParams.set("key", apiKey);

  const params = options.params ?? {};
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      url.searchParams.set(key, value.join("|"));
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  const resp = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(
      `Google Maps API request failed (${resp.status} ${resp.statusText}): ${detail}`
    );
  }

  return resp.json() as T;
}
