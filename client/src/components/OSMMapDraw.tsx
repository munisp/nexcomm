/**
 * OSMMapDraw — MapLibre GL + OpenStreetMap + Terra Draw polygon tool
 *
 * Props:
 *   initialLat / initialLng  — starting map center (default: Nigeria centroid)
 *   initialZoom              — starting zoom level (default: 6)
 *   onPinChange              — called when the user clicks to set/move the centroid pin
 *   onBoundaryChange         — called when the polygon boundary changes (GeoJSON Feature)
 *   onBoundaryStats          — called with area_ha / perimeter_km from Sedona after draw
 *   readOnly                 — disables drawing and pin interaction
 *   height                   — CSS height string (default "400px")
 */

import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  TerraDrawPointMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Pencil, Trash2, Check, Loader2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PinLocation {
  lat: number;
  lng: number;
  address?: string;
}

export interface BoundaryStats {
  area_ha: number;
  perimeter_km: number;
  centroid: { lat: number; lng: number };
}

interface OSMMapDrawProps {
  initialLat?: number;
  initialLng?: number;
  initialZoom?: number;
  initialPin?: PinLocation | null;
  initialBoundary?: GeoJSON.Feature<GeoJSON.Polygon> | null;
  onPinChange?: (pin: PinLocation | null) => void;
  onBoundaryChange?: (boundary: GeoJSON.Feature<GeoJSON.Polygon> | null) => void;
  onBoundaryStats?: (stats: BoundaryStats) => void;
  readOnly?: boolean;
  height?: string;
  showDrawTools?: boolean;
}

// ─── OSM tile style ───────────────────────────────────────────────────────────

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function OSMMapDraw({
  initialLat = 9.082,
  initialLng = 8.6753,
  initialZoom = 6,
  initialPin = null,
  initialBoundary = null,
  onPinChange,
  onBoundaryChange,
  onBoundaryStats,
  readOnly = false,
  height = "400px",
  showDrawTools = true,
}: OSMMapDrawProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);

  const [pin, setPin] = useState<PinLocation | null>(initialPin);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasBoundary, setHasBoundary] = useState(!!initialBoundary);
  const [boundaryStats, setBoundaryStats] = useState<BoundaryStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [reverseGeocoding, setReverseGeocoding] = useState(false);

  // ─── Reverse geocode via Nominatim ─────────────────────────────────────────

  const reverseGeocode = useCallback(async (lat: number, lng: number): Promise<string> => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14`,
        { headers: { "Accept-Language": "en" } }
      );
      const data = await res.json();
      return data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }, []);

  // ─── Fetch boundary stats from Sedona service ──────────────────────────────

  const fetchBoundaryStats = useCallback(
    async (geojson: GeoJSON.Polygon) => {
      setStatsLoading(true);
      try {
        const res = await fetch("/api/spatial/boundary-stats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ geojson }),
        });
        if (res.ok) {
          const stats: BoundaryStats = await res.json();
          setBoundaryStats(stats);
          onBoundaryStats?.(stats);
        }
      } catch {
        // Sedona service may not be running in production; silently skip
      } finally {
        setStatsLoading(false);
      }
    },
    [onBoundaryStats]
  );

  // ─── Map initialisation ────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: OSM_STYLE,
      center: [initialLng, initialLat],
      zoom: initialZoom,
      attributionControl: { compact: false },
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    mapRef.current = map;

    map.on("load", () => {
      // ── Boundary polygon source/layer ─────────────────────────────────────
      map.addSource("boundary", {
        type: "geojson",
        data: initialBoundary
          ? { type: "FeatureCollection", features: [initialBoundary] }
          : { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "boundary-fill",
        type: "fill",
        source: "boundary",
        paint: { "fill-color": "#22c55e", "fill-opacity": 0.2 },
      });
      map.addLayer({
        id: "boundary-line",
        type: "line",
        source: "boundary",
        paint: { "line-color": "#16a34a", "line-width": 2, "line-dasharray": [2, 1] },
      });

      // ── Restore initial pin ───────────────────────────────────────────────
      if (initialPin) {
        const el = _createMarkerEl();
        markerRef.current = new maplibregl.Marker({ element: el, draggable: !readOnly })
          .setLngLat([initialPin.lng, initialPin.lat])
          .addTo(map);

        if (!readOnly) {
          markerRef.current.on("dragend", async () => {
            const lngLat = markerRef.current!.getLngLat();
            setReverseGeocoding(true);
            const address = await reverseGeocode(lngLat.lat, lngLat.lng);
            setReverseGeocoding(false);
            const newPin = { lat: lngLat.lat, lng: lngLat.lng, address };
            setPin(newPin);
            onPinChange?.(newPin);
          });
        }
      }

      // ── Click-to-pin (when not drawing) ───────────────────────────────────
      if (!readOnly) {
        map.on("click", async (e) => {
          if (isDrawingRef.current) return;
          const { lat, lng } = e.lngLat;

          setReverseGeocoding(true);
          const address = await reverseGeocode(lat, lng);
          setReverseGeocoding(false);

          const newPin: PinLocation = { lat, lng, address };

          if (markerRef.current) {
            markerRef.current.setLngLat([lng, lat]);
          } else {
            const el = _createMarkerEl();
            markerRef.current = new maplibregl.Marker({ element: el, draggable: true })
              .setLngLat([lng, lat])
              .addTo(map);
            markerRef.current.on("dragend", async () => {
              const ll = markerRef.current!.getLngLat();
              setReverseGeocoding(true);
              const addr = await reverseGeocode(ll.lat, ll.lng);
              setReverseGeocoding(false);
              const p = { lat: ll.lat, lng: ll.lng, address: addr };
              setPin(p);
              onPinChange?.(p);
            });
          }

          setPin(newPin);
          onPinChange?.(newPin);
        });
      }

      // ── Terra Draw setup ──────────────────────────────────────────────────
      if (!readOnly && showDrawTools) {
        const draw = new TerraDraw({
          adapter: new TerraDrawMapLibreGLAdapter({ map }),
          modes: [
            new TerraDrawPolygonMode({
              snapping: { toCoordinate: true },
            }),
            new TerraDrawSelectMode({
              flags: {
                polygon: {
                  feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } },
                },
              },
            }),
            new TerraDrawPointMode(),
          ],
        });

        draw.on("finish", (id) => {
          const snapshot = draw.getSnapshot();
          const feature = snapshot.find((f) => f.id === id);
          if (!feature || feature.geometry.type !== "Polygon") return;

          const geojsonFeature = feature as GeoJSON.Feature<GeoJSON.Polygon>;

          // Update the boundary layer
          const src = map.getSource("boundary") as maplibregl.GeoJSONSource;
          src.setData({ type: "FeatureCollection", features: [geojsonFeature] });

          setHasBoundary(true);
          setIsDrawing(false);
          draw.setMode("select");
          onBoundaryChange?.(geojsonFeature);
          fetchBoundaryStats(geojsonFeature.geometry);
        });

        drawRef.current = draw;
        draw.start();
        draw.setMode("select");
      }
    });

    return () => {
      drawRef.current?.stop();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track isDrawing in a ref so the click handler closure stays current
  const isDrawingRef = useRef(false);
  useEffect(() => {
    isDrawingRef.current = isDrawing;
  }, [isDrawing]);

  // ─── Draw controls ─────────────────────────────────────────────────────────

  const startDrawing = () => {
    if (!drawRef.current) return;
    drawRef.current.setMode("polygon");
    setIsDrawing(true);
  };

  const clearBoundary = () => {
    if (!drawRef.current || !mapRef.current) return;
    drawRef.current.clear();
    const src = mapRef.current.getSource("boundary") as maplibregl.GeoJSONSource;
    src?.setData({ type: "FeatureCollection", features: [] });
    setHasBoundary(false);
    setBoundaryStats(null);
    onBoundaryChange?.(null);
  };

  const finishDrawing = () => {
    if (!drawRef.current) return;
    drawRef.current.setMode("select");
    setIsDrawing(false);
  };

  // ─── Marker element ────────────────────────────────────────────────────────

  function _createMarkerEl(): HTMLElement {
    const el = document.createElement("div");
    el.style.cssText =
      "width:28px;height:28px;background:#16a34a;border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:pointer;";
    return el;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full rounded-lg overflow-hidden border border-border" style={{ height }}>
      {/* Map container */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Draw toolbar (top-left) */}
      {!readOnly && showDrawTools && (
        <div className="absolute top-3 left-3 flex flex-col gap-1.5 z-10">
          {!isDrawing && !hasBoundary && (
            <Button size="sm" variant="secondary" onClick={startDrawing} className="shadow-md text-xs gap-1.5">
              <Pencil className="w-3.5 h-3.5" />
              Draw Boundary
            </Button>
          )}
          {isDrawing && (
            <Button size="sm" variant="default" onClick={finishDrawing} className="shadow-md text-xs gap-1.5 bg-green-600 hover:bg-green-700">
              <Check className="w-3.5 h-3.5" />
              Finish Drawing
            </Button>
          )}
          {hasBoundary && !isDrawing && (
            <Button size="sm" variant="destructive" onClick={clearBoundary} className="shadow-md text-xs gap-1.5">
              <Trash2 className="w-3.5 h-3.5" />
              Clear Boundary
            </Button>
          )}
        </div>
      )}

      {/* Pin / geocode status (bottom-center) */}
      {(pin || reverseGeocoding) && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 max-w-xs">
          <Badge variant="secondary" className="shadow-md text-xs gap-1.5 px-3 py-1.5">
            {reverseGeocoding ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Locating…</>
            ) : (
              <><MapPin className="w-3 h-3 text-green-600" />{pin?.address ?? `${pin?.lat.toFixed(5)}, ${pin?.lng.toFixed(5)}`}</>
            )}
          </Badge>
        </div>
      )}

      {/* Boundary stats chip (top-right, below nav controls) */}
      {(boundaryStats || statsLoading) && (
        <div className="absolute top-16 right-3 z-10">
          <Badge variant="outline" className="shadow-md bg-background text-xs gap-1 px-2.5 py-1">
            {statsLoading ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Computing area…</>
            ) : (
              <>
                <span className="font-semibold text-green-700">{boundaryStats?.area_ha.toFixed(2)} ha</span>
                <span className="text-muted-foreground">· {boundaryStats?.perimeter_km.toFixed(2)} km perimeter</span>
              </>
            )}
          </Badge>
        </div>
      )}

      {/* Drawing hint */}
      {isDrawing && (
        <div className="absolute bottom-8 right-3 z-10">
          <Badge className="bg-green-700 text-white text-xs shadow-md">
            Click to add points · Double-click to close
          </Badge>
        </div>
      )}
    </div>
  );
}
