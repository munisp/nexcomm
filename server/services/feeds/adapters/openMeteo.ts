/**
 * openMeteo.ts — agro-weather adapter (Open-Meteo, FREE, no API key).
 *
 * Fetches current conditions + 7-day daily forecast for Nigeria's key
 * agricultural zones in ONE batched request (Open-Meteo accepts comma-separated
 * lat/lon). Optional rainfall history (past 30 days) via the archive API when
 * FEEDS_WEATHER_RAINFALL_HISTORY=true.
 *
 * Env:
 *   FEEDS_WEATHER_LOCATIONS        JSON array override:
 *                                  [{"key":"kano","name":"Kano","state":"Kano","lat":12.0,"lon":8.52}, …]
 *   FEEDS_WEATHER_RAINFALL_HISTORY "true" to include 30-day rainfall history
 *
 * Payload (normalized):
 *   { location, state, lat, lon, timezone,
 *     current: { tempC, humidity, precipMm, windKph },
 *     daily: [{ date, tempMaxC, tempMinC, precipMm, precipProbPct }…],
 *     rainfallHistory?: [{ date, precipMm }…] }
 */
import { z } from "zod";
import type { FeedAdapter, FeedSnapshot } from "../types";
import { httpGetJson } from "../http";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const WEATHER_TTL_SECONDS = 30 * 60;

export interface WeatherLocation {
  key: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
}

/** Default ag zones: grain belt (Kano/Kaduna), food basket (Benue), SW (Oyo),
 *  highland tubers (Plateau), southern tree crops (Cross River). */
export const DEFAULT_WEATHER_LOCATIONS: WeatherLocation[] = [
  { key: "kano",        name: "Kano",        state: "Kano",        lat: 12.00, lon: 8.52 },
  { key: "kaduna",      name: "Kaduna",      state: "Kaduna",      lat: 10.52, lon: 7.44 },
  { key: "makurdi",     name: "Makurdi",     state: "Benue",       lat: 7.73,  lon: 8.54 },
  { key: "ibadan",      name: "Ibadan",      state: "Oyo",         lat: 7.38,  lon: 3.90 },
  { key: "jos",         name: "Jos",         state: "Plateau",     lat: 9.90,  lon: 8.89 },
  { key: "calabar",     name: "Calabar",     state: "Cross River", lat: 4.95,  lon: 8.32 },
];

const locationSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  state: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export function weatherLocations(): WeatherLocation[] {
  const raw = process.env.FEEDS_WEATHER_LOCATIONS;
  if (!raw) return DEFAULT_WEATHER_LOCATIONS;
  try {
    const parsed = z.array(locationSchema).parse(JSON.parse(raw));
    return parsed.length > 0 ? parsed : DEFAULT_WEATHER_LOCATIONS;
  } catch (err) {
    console.warn("[Feeds:openmeteo] FEEDS_WEATHER_LOCATIONS invalid — using defaults:", (err as Error).message);
    return DEFAULT_WEATHER_LOCATIONS;
  }
}

const currentBlock = z.object({
  temperature_2m: z.number(),
  relative_humidity_2m: z.number(),
  precipitation: z.number(),
  wind_speed_10m: z.number(),
});
const dailyBlock = z.object({
  time: z.array(z.string()),
  temperature_2m_max: z.array(z.number().nullable()),
  temperature_2m_min: z.array(z.number().nullable()),
  precipitation_sum: z.array(z.number().nullable()),
  precipitation_probability_max: z.array(z.number().nullable()).optional(),
});
const forecastResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string().optional(),
  current: currentBlock,
  daily: dailyBlock,
});
const archiveResponseSchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    precipitation_sum: z.array(z.number().nullable()),
  }),
});

export const openMeteoAdapter: FeedAdapter = {
  name: "openmeteo",
  kind: "weather",
  ttlSeconds: WEATHER_TTL_SECONDS,        // fresh for 30 min
  intervalSeconds: WEATHER_TTL_SECONDS,   // poll every 30 min (+ jitter/backoff)

  isEnabled: () => true, // free, keyless — always configured

  async fetch(): Promise<FeedSnapshot[]> {
    const locations = weatherLocations();
    const includeHistory = process.env.FEEDS_WEATHER_RAINFALL_HISTORY === "true";
    const params = new URLSearchParams({
      latitude: locations.map((l) => String(l.lat)).join(","),
      longitude: locations.map((l) => String(l.lon)).join(","),
      current: "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m",
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max",
      timezone: "Africa/Lagos",
      forecast_days: "7",
      wind_speed_unit: "kmh",
    });

    const raw = await httpGetJson<unknown>(`${FORECAST_URL}?${params.toString()}`);
    const parsed = z
      .union([forecastResponseSchema, z.array(forecastResponseSchema)])
      .parse(raw);
    const responses = Array.isArray(parsed) ? parsed : [parsed];

    const now = new Date();
    const snapshots: FeedSnapshot[] = [];

    for (let i = 0; i < responses.length; i++) {
      const r = responses[i];
      const loc = locations[i] ?? {
        key: `loc-${i}`,
        name: `${r.latitude.toFixed(2)},${r.longitude.toFixed(2)}`,
        state: "Nigeria",
        lat: r.latitude,
        lon: r.longitude,
      };

      let rainfallHistory: Array<{ date: string; precipMm: number }> | undefined;
      if (includeHistory) {
        try {
          const end = new Date(now.getTime() - 24 * 3600 * 1000);
          const start = new Date(end.getTime() - 29 * 24 * 3600 * 1000);
          const fmt = (d: Date) => d.toISOString().slice(0, 10);
          const archiveRaw = await httpGetJson<unknown>(
            `${ARCHIVE_URL}?latitude=${loc.lat}&longitude=${loc.lon}&start_date=${fmt(start)}&end_date=${fmt(end)}&daily=precipitation_sum&timezone=Africa%2FLagos`
          );
          const archive = archiveResponseSchema.parse(archiveRaw);
          rainfallHistory = archive.daily.time.map((date, j) => ({
            date,
            precipMm: archive.daily.precipitation_sum[j] ?? 0,
          }));
        } catch (err) {
          console.warn(`[Feeds:openmeteo] rainfall history failed for ${loc.key} (non-fatal):`, (err as Error).message);
        }
      }

      snapshots.push({
        feed: "openmeteo",
        symbol: loc.key,
        region: loc.state,
        payload: {
          location: loc.name,
          state: loc.state,
          lat: loc.lat,
          lon: loc.lon,
          timezone: r.timezone ?? "Africa/Lagos",
          current: {
            tempC: r.current.temperature_2m,
            humidity: r.current.relative_humidity_2m,
            precipMm: r.current.precipitation,
            windKph: r.current.wind_speed_10m,
          },
          daily: r.daily.time.map((date, j) => ({
            date,
            tempMaxC: r.daily.temperature_2m_max[j] ?? null,
            tempMinC: r.daily.temperature_2m_min[j] ?? null,
            precipMm: r.daily.precipitation_sum[j] ?? 0,
            precipProbPct: r.daily.precipitation_probability_max?.[j] ?? null,
          })),
          ...(rainfallHistory ? { rainfallHistory } : {}),
        },
        fetchedAt: now,
        validUntil: new Date(now.getTime() + WEATHER_TTL_SECONDS * 1000),
      });
    }
    return snapshots;
  },
};
