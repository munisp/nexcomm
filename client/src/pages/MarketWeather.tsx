/**
 * MarketWeather.tsx (DATA-FEEDS) — /market-weather
 * Public agro-weather + external reference prices for farmers and traders.
 *
 *  - Weather cards per ag zone: current conditions + 7-day strip.
 *  - Reference-price table with source / asOf / stale badges (AFEX, operator CSV).
 *  - Stale (last-known-good) data is explicitly badged — never silently fresh.
 *  - Connection-quality aware: slow links poll less and collapse the 7-day strip.
 *  - Endpoints are on the SWR read-cache allowlist → page works offline with
 *    the last cached response (24h cap, per sw.js policy).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useConnectionQuality } from "@/lib/connectionQuality";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CloudRain,
  CloudSun,
  Droplets,
  Wind,
  Thermometer,
  MapPin,
  Loader2,
  AlertTriangle,
  WifiOff,
  CalendarDays,
} from "lucide-react";

import { formatNGN } from "@/lib/format";

interface DailyForecast {
  date: string;
  tempMaxC: number | null;
  tempMinC: number | null;
  precipMm: number;
  precipProbPct: number | null;
}

interface WeatherPayload {
  location: string;
  state: string;
  lat: number;
  lon: number;
  timezone: string;
  current: { tempC: number; humidity: number; precipMm: number; windKph: number };
  daily: DailyForecast[];
}

interface WeatherSnapshot {
  feed: string;
  symbol?: string;
  region?: string;
  payload: WeatherPayload;
  fetchedAt: string;
  validUntil?: string;
  stale: boolean;
  servedAt: string;
  source: string;
}

function StaleBadge({ stale }: { stale: boolean }) {
  if (!stale) return null;
  return (
    <Badge variant="outline" className="border-amber-500 text-amber-600 gap-1">
      <AlertTriangle className="h-3 w-3" /> stale
    </Badge>
  );
}

function formatDay(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-NG", { weekday: "short" });
}

function formatAsOf(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function WeatherCard({ snap, compact }: { snap: WeatherSnapshot; compact: boolean }) {
  const p = snap.payload;
  const days = compact ? p.daily.slice(0, 3) : p.daily.slice(0, 7);
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            {p.location}
            <span className="text-xs font-normal text-muted-foreground">{p.state}</span>
          </CardTitle>
          <StaleBadge stale={snap.stale} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Thermometer className="h-4 w-4 text-orange-500" />
            <span className="font-medium">{p.current.tempC.toFixed(1)}°C</span>
          </div>
          <div className="flex items-center gap-2">
            <Droplets className="h-4 w-4 text-blue-500" />
            <span>{Math.round(p.current.humidity)}%</span>
          </div>
          <div className="flex items-center gap-2">
            <CloudRain className="h-4 w-4 text-sky-600" />
            <span>{p.current.precipMm.toFixed(1)} mm</span>
          </div>
          <div className="flex items-center gap-2">
            <Wind className="h-4 w-4 text-muted-foreground" />
            <span>{Math.round(p.current.windKph)} km/h</span>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-7 gap-1 border-t pt-2">
          {days.map((d) => (
            <div key={d.date} className="flex flex-col items-center text-xs py-1">
              <span className="text-muted-foreground">{formatDay(d.date)}</span>
              {d.precipMm > 0.5 ? (
                <CloudRain className="h-4 w-4 text-sky-600 my-1" />
              ) : (
                <CloudSun className="h-4 w-4 text-amber-500 my-1" />
              )}
              <span className="font-medium">
                {d.tempMaxC != null ? `${Math.round(d.tempMaxC)}°` : "—"}
                <span className="text-muted-foreground">
                  {" / "}{d.tempMinC != null ? `${Math.round(d.tempMinC)}°` : "—"}
                </span>
              </span>
              {d.precipProbPct != null && d.precipProbPct > 0 && (
                <span className="text-sky-700">{d.precipProbPct}%</span>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Updated {formatAsOf(snap.fetchedAt)}
          {snap.stale ? " — last known good (feed unavailable)" : ""}
        </p>
      </CardContent>
    </Card>
  );
}

export default function MarketWeather() {
  const { quality } = useConnectionQuality();
  const slow = quality !== "fast";
  const [selected, setSelected] = useState<string | null>(null);

  // Slow connections: longer staleTime, no background refetch (OFFLINE-RES tuning).
  const queryOpts = {
    staleTime: slow ? 15 * 60 * 1000 : 5 * 60 * 1000,
    refetchInterval: slow ? false as const : 5 * 60 * 1000,
    retry: 1,
  };

  const locationsQuery = trpc.feeds.listWeatherLocations.useQuery(undefined, queryOpts);
  const weatherQuery = trpc.feeds.getWeather.useQuery(
    selected ? { locationKey: selected } : undefined,
    queryOpts
  );
  const pricesQuery = trpc.feeds.getReferencePrices.useQuery(undefined, queryOpts);

  const snapshots = (weatherQuery.data?.snapshots ?? []) as unknown as WeatherSnapshot[];
  const prices = pricesQuery.data?.prices ?? [];
  const anyStale =
    snapshots.some((s) => s.stale) || prices.some((p) => p.stale);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Market Weather &amp; Reference Prices</h1>
          <p className="text-sm text-muted-foreground">
            Agro-weather for Nigeria&apos;s key production zones and external
            reference prices. Free Open-Meteo data; offline-tolerant.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {quality === "offline" && (
            <Badge variant="outline" className="border-red-500 text-red-600 gap-1">
              <WifiOff className="h-3 w-3" /> offline — cached data
            </Badge>
          )}
          {anyStale && (
            <Badge variant="outline" className="border-amber-500 text-amber-600 gap-1">
              <AlertTriangle className="h-3 w-3" /> some data is stale
            </Badge>
          )}
        </div>
      </div>

      {/* Zone picker */}
      {locationsQuery.data && locationsQuery.data.locations.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Badge
            variant={selected === null ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setSelected(null)}
          >
            All zones
          </Badge>
          {locationsQuery.data.locations.map((l) => (
            <Badge
              key={l.key}
              variant={selected === l.key ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setSelected(l.key)}
            >
              {l.name}
            </Badge>
          ))}
        </div>
      )}

      {/* Weather cards */}
      {weatherQuery.isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading weather…
        </div>
      ) : snapshots.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Weather data is not available yet. It will appear after the first
            successful feed refresh; previously cached data is shown when offline.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {snapshots.map((s) => (
            <WeatherCard key={s.symbol ?? s.region ?? "zone"} snap={s} compact={slow} />
          ))}
        </div>
      )}

      {/* Reference prices */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            External Reference Prices
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pricesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading reference prices…
            </div>
          ) : prices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No external reference prices configured yet. When an AFEX feed or an
              operator CSV is enabled, indicative prices appear here with their
              source and timestamp.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">₦/kg</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>As of</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prices.map((p) => (
                  <TableRow key={`${p.source}-${p.symbol}`}>
                    <TableCell className="font-medium">{p.symbol}</TableCell>
                    <TableCell className="text-right">
                      {p.currency === "NGN" ? formatNGN(p.price) : `${p.price.toLocaleString()} ${p.currency}`}
                      {p.unit ? <span className="text-xs text-muted-foreground"> /{p.unit}</span> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.priceNgnPerKg != null ? formatNGN(p.priceNgnPerKg) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{p.source}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatAsOf(p.asOf)}
                    </TableCell>
                    <TableCell>
                      {p.stale ? <StaleBadge stale /> : <Badge variant="outline" className="border-green-500 text-green-600">live</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
