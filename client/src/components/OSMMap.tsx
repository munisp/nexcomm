/**
 * OSMMap — Reusable MapLibre GL map with OpenStreetMap tiles.
 *
 * Features:
 *  - Click anywhere to drop a pin (marker)
 *  - Reverse-geocodes the clicked coordinate via Nominatim (OSM)
 *  - Calls onLocationSelect({ lat, lng, label }) when a pin is placed
 *  - Accepts an optional initialPin to restore a previously saved location
 *  - No API key required — OSM tiles and Nominatim are free
 *
 * Usage:
 *   <OSMMap
 *     onLocationSelect={({ lat, lng, label }) => { ... }}
 *     initialPin={{ lat: 9.0765, lng: 7.3986 }}
 *     height="320px"
 *   />
 */
import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin, Loader2 } from "lucide-react";

export interface PinLocation {
  lat: number;
  lng: number;
  label: string; // human-readable address from Nominatim
}

interface OSMMapProps {
  onLocationSelect?: (loc: PinLocation) => void;
  initialPin?: { lat: number; lng: number };
  height?: string;
  className?: string;
  readonly?: boolean;
}

// Nigeria centroid — default view when no initial pin is provided
const NIGERIA_CENTER: [number, number] = [8.6753, 9.082];
const DEFAULT_ZOOM = 5.5;
const PIN_ZOOM = 13;

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { "Accept-Language": "en" } }
    );
    if (!res.ok) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const data = await res.json();
    return (
      data.display_name ??
      data.address?.village ??
      data.address?.town ??
      data.address?.city ??
      `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    );
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

export default function OSMMap({
  onLocationSelect,
  initialPin,
  height = "320px",
  className = "",
  readonly = false,
}: OSMMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [pinLabel, setPinLabel] = useState<string | null>(null);
  const [pinCoords, setPinCoords] = useState<{ lat: number; lng: number } | null>(
    initialPin ?? null
  );

  const placePin = useCallback(
    async (lat: number, lng: number) => {
      if (!mapRef.current) return;

      // Remove old marker
      markerRef.current?.remove();

      // Create new marker element
      const el = document.createElement("div");
      el.className = "osm-pin-marker";
      el.style.cssText = `
        width: 32px; height: 32px;
        background: #16a34a;
        border: 3px solid #fff;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        cursor: ${readonly ? "default" : "pointer"};
      `;

      markerRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([lng, lat])
        .addTo(mapRef.current);

      setPinCoords({ lat, lng });
      setGeocoding(true);
      const label = await reverseGeocode(lat, lng);
      setGeocoding(false);
      setPinLabel(label);
      onLocationSelect?.({ lat, lng, label });
    },
    [onLocationSelect, readonly]
  );

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const center: [number, number] = initialPin
      ? [initialPin.lng, initialPin.lat]
      : NIGERIA_CENTER;
    const zoom = initialPin ? PIN_ZOOM : DEFAULT_ZOOM;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [
          {
            id: "osm-tiles",
            type: "raster",
            source: "osm",
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center,
      zoom,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }),
      "bottom-left"
    );

    mapRef.current = map;

    // Place initial pin if provided
    if (initialPin) {
      map.on("load", () => {
        placePin(initialPin.lat, initialPin.lng);
      });
    }

    // Click handler — only when not readonly
    if (!readonly) {
      map.on("click", (e) => {
        placePin(e.lngLat.lat, e.lngLat.lng);
      });

      // Change cursor on hover to indicate clickability
      map.getCanvas().style.cursor = "crosshair";
    }

    return () => {
      markerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`relative rounded-xl overflow-hidden border border-green-800/40 ${className}`}>
      {/* Map container */}
      <div ref={containerRef} style={{ height, width: "100%" }} />

      {/* Instruction overlay — shown when no pin yet */}
      {!readonly && !pinCoords && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/60 backdrop-blur-sm rounded-lg px-4 py-2 flex items-center gap-2 text-sm text-white">
            <MapPin className="w-4 h-4 text-green-400" />
            Tap the map to pin your farm location
          </div>
        </div>
      )}

      {/* Geocoding indicator */}
      {geocoding && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/70 rounded-full px-3 py-1 flex items-center gap-2 text-xs text-white">
          <Loader2 className="w-3 h-3 animate-spin" />
          Looking up address…
        </div>
      )}

      {/* Pin label chip */}
      {pinLabel && !geocoding && (
        <div className="absolute bottom-8 left-2 right-2 bg-green-950/90 border border-green-700/50 rounded-lg px-3 py-2 flex items-start gap-2">
          <MapPin className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" />
          <p className="text-xs text-green-200 leading-tight line-clamp-2">{pinLabel}</p>
        </div>
      )}

      {/* Coordinates chip */}
      {pinCoords && (
        <div className="absolute top-2 left-2 bg-black/70 rounded px-2 py-1 text-xs text-white font-mono">
          {pinCoords.lat.toFixed(5)}, {pinCoords.lng.toFixed(5)}
        </div>
      )}
    </div>
  );
}
