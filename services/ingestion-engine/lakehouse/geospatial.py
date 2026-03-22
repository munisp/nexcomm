"""
Geospatial Layer — Spatial analytics powered by Apache Sedona.

Stores GeoParquet data for commodity production regions, trade routes,
weather grids, warehouse/port locations, and enriched spatial data.

Apache Sedona Integration:
  - Spatial indexes (R-tree) on all geometry columns
  - Point-in-polygon: Which production region does a sensor/vessel lie in?
  - Distance queries: Nearest warehouse to a delivery point
  - Spatial joins: Weather at vessel location, NDVI at farm coordinates
  - Route analysis: Shortest path between warehouses and ports

Coordinate Reference System: EPSG:4326 (WGS 84)

Key Spatial Datasets:
  ┌───────────────────────────────────────────────────────────────────┐
  │                   GEOSPATIAL LAYER                                │
  │                                                                   │
  │  Production Regions ── Polygons for commodity-growing areas       │
  │  Trade Routes ──────── LineStrings for shipping/rail routes       │
  │  Weather Grids ─────── Gridded weather at 0.25° resolution       │
  │  Warehouses ────────── Points for 9 certified warehouses         │
  │  Ports ─────────────── Points for 5 monitored ports              │
  │  Enriched ──────────── Flink-enriched vessel + fleet positions   │
  └───────────────────────────────────────────────────────────────────┘
"""

import logging
from datetime import datetime, timezone

logger = logging.getLogger("ingestion-engine.geospatial")


class SpatialDataset:
    """Represents a geospatial dataset in the Lakehouse."""

    def __init__(
        self,
        name: str,
        geometry_type: str,
        srid: int,
        feature_count: int,
        description: str,
        sedona_index: str = "RTREE",
        columns: list[str] | None = None,
    ):
        self.name = name
        self.geometry_type = geometry_type
        self.srid = srid
        self.feature_count = feature_count
        self.description = description
        self.sedona_index = sedona_index
        self.columns = columns or []
        self.last_updated = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "geometry_type": self.geometry_type,
            "srid": self.srid,
            "feature_count": self.feature_count,
            "description": self.description,
            "sedona_index": self.sedona_index,
            "columns": self.columns,
            "last_updated": self.last_updated,
        }


class GeospatialLayerManager:
    """Manages the Geospatial layer with Apache Sedona integration."""

    def __init__(self, base_path: str):
        self.base_path = base_path
        self._datasets: dict[str, SpatialDataset] = {}
        self._sedona_queries: list[dict] = []
        self._initialize_datasets()
        self._register_common_queries()
        logger.info(f"Geospatial layer initialized at {base_path}: {len(self._datasets)} datasets")

    def _initialize_datasets(self):
        self._datasets["production_regions"] = SpatialDataset(
            name="production_regions",
            geometry_type="MultiPolygon",
            srid=4326,
            feature_count=48,
            description=(
                "Commodity production region polygons across Africa and key global areas. "
                "Regions: Kenya Highland (coffee, tea), Kenya Rift Valley (maize, wheat), "
                "Ethiopia Sidama (coffee), Ghana Ashanti (cocoa), Ghana Western (cocoa), "
                "Nigeria Kano (cotton), South Africa Mpumalanga (maize), "
                "Tanzania Kilimanjaro (coffee), Tanzania Mbeya (tea), "
                "Uganda Bugisu (coffee), Ivory Coast (cocoa), Cameroon (cocoa), "
                "DRC Katanga (copper), Zambia Copperbelt (copper), "
                "South Africa Witwatersrand (gold), Mali Kayes (gold), "
                "Ghana Obuasi (gold), Zimbabwe Great Dyke (platinum). "
                "Each polygon includes: commodity, annual_production_mt, area_km2, "
                "yield_per_hectare, growing_season_months."
            ),
            columns=["geometry", "region_id", "region_name", "country", "commodity",
                     "annual_production_mt", "area_km2", "yield_per_hectare",
                     "growing_season_start", "growing_season_end"],
        )

        self._datasets["trade_routes"] = SpatialDataset(
            name="trade_routes",
            geometry_type="LineString",
            srid=4326,
            feature_count=156,
            description=(
                "Commodity trade routes: sea lanes (Mombasa→Rotterdam, "
                "Lagos→Hamburg, Durban→Shanghai), rail corridors (Northern Corridor "
                "Kenya, Tanzania Central, South Africa coal lines), road routes "
                "between production areas and warehouses/ports."
            ),
            columns=["geometry", "route_id", "route_name", "route_type",
                     "origin", "destination", "distance_km", "avg_transit_days",
                     "commodities_carried", "capacity_mt_per_month"],
        )

        self._datasets["weather_grids"] = SpatialDataset(
            name="weather_grids",
            geometry_type="Point",
            srid=4326,
            feature_count=50_000_000,
            description=(
                "Gridded weather data at 0.25° resolution covering Africa and "
                "key global commodity regions. Variables: temperature_c, "
                "precipitation_mm, soil_moisture, wind_speed, humidity. "
                "Updated every 6 hours from GFS and ECMWF."
            ),
            columns=["geometry", "grid_id", "latitude", "longitude",
                     "temperature_c", "precipitation_mm", "soil_moisture",
                     "wind_speed_ms", "humidity_pct", "forecast_hour", "valid_time"],
        )

        self._datasets["warehouse_locations"] = SpatialDataset(
            name="warehouse_locations",
            geometry_type="Point",
            srid=4326,
            feature_count=9,
            description=(
                "NEXCOM certified warehouse locations: "
                "Nairobi (-1.2921, 36.8219), Mombasa (-4.0435, 39.6682), "
                "Dar es Salaam (-6.7924, 39.2083), Addis Ababa (9.0250, 38.7469), "
                "Lagos (6.5244, 3.3792), Accra (5.6037, -0.1870), "
                "Johannesburg (-26.2041, 28.0473), London (51.5074, -0.1278), "
                "Dubai (25.2048, 55.2708)."
            ),
            columns=["geometry", "warehouse_id", "name", "city", "country",
                     "capacity_mt", "commodities_stored", "temperature_controlled",
                     "certifications", "operator"],
        )

        self._datasets["port_locations"] = SpatialDataset(
            name="port_locations",
            geometry_type="Point",
            srid=4326,
            feature_count=5,
            description=(
                "Monitored port locations: Mombasa (Kenya), Dar es Salaam (Tanzania), "
                "Lagos/Apapa (Nigeria), Durban (South Africa), Djibouti."
            ),
            columns=["geometry", "port_id", "name", "country", "latitude",
                     "longitude", "annual_throughput_teu", "commodity_berths",
                     "avg_dwell_time_days"],
        )

        self._datasets["enriched"] = SpatialDataset(
            name="enriched",
            geometry_type="Point",
            srid=4326,
            feature_count=100_000_000,
            description=(
                "Flink-enriched spatial data combining AIS vessel tracking, "
                "fleet GPS, and weather data with geospatial context. "
                "Each point includes: nearest port, maritime zone, weather "
                "at location, estimated cargo value."
            ),
            columns=["geometry", "source_id", "source_type", "latitude",
                     "longitude", "speed", "heading", "nearest_port",
                     "nearest_port_distance_nm", "maritime_zone", "weather_temp_c",
                     "weather_wind_ms", "estimated_cargo_mt", "timestamp"],
        )

    def _register_common_queries(self):
        """Register commonly used Sedona spatial queries."""
        self._sedona_queries = [
            {
                "name": "vessels_in_port_radius",
                "description": "Find all vessels within N nautical miles of a port",
                "sql": (
                    "SELECT v.*, p.name AS port_name "
                    "FROM geospatial.enriched v, geospatial.port_locations p "
                    "WHERE ST_DistanceSphere(v.geometry, p.geometry) < {radius_m} "
                    "AND v.source_type = 'VESSEL'"
                ),
            },
            {
                "name": "production_region_weather",
                "description": "Get current weather for all production regions",
                "sql": (
                    "SELECT r.region_name, r.commodity, "
                    "AVG(w.temperature_c) as avg_temp, AVG(w.precipitation_mm) as avg_precip "
                    "FROM geospatial.production_regions r "
                    "JOIN geospatial.weather_grids w "
                    "ON ST_Contains(r.geometry, w.geometry) "
                    "GROUP BY r.region_name, r.commodity"
                ),
            },
            {
                "name": "nearest_warehouse",
                "description": "Find nearest warehouse to a given coordinate",
                "sql": (
                    "SELECT w.name, w.city, w.capacity_mt, "
                    "ST_DistanceSphere(w.geometry, ST_Point({lon}, {lat})) AS distance_m "
                    "FROM geospatial.warehouse_locations w "
                    "ORDER BY distance_m LIMIT 3"
                ),
            },
            {
                "name": "crop_health_by_region",
                "description": "Get NDVI-based crop health for production regions",
                "sql": (
                    "SELECT r.region_name, r.commodity, r.country, "
                    "s.ndvi_mean, s.ndvi_anomaly "
                    "FROM geospatial.production_regions r "
                    "JOIN gold.ml_features.geospatial_features s "
                    "ON r.region_id = s.region_id "
                    "ORDER BY s.ndvi_anomaly ASC"
                ),
            },
            {
                "name": "trade_route_congestion",
                "description": "Compute congestion score for active trade routes",
                "sql": (
                    "SELECT tr.route_name, tr.origin, tr.destination, "
                    "COUNT(v.source_id) AS vessels_on_route, "
                    "AVG(v.speed) AS avg_speed_knots "
                    "FROM geospatial.trade_routes tr "
                    "JOIN geospatial.enriched v "
                    "ON ST_DWithin(tr.geometry, v.geometry, 0.5) "
                    "GROUP BY tr.route_name, tr.origin, tr.destination "
                    "ORDER BY vessels_on_route DESC"
                ),
            },
        ]

    def status(self) -> dict:
        total_features = sum(ds.feature_count for ds in self._datasets.values())
        return {
            "status": "healthy",
            "base_path": self.base_path,
            "dataset_count": len(self._datasets),
            "total_spatial_features": total_features,
            "crs": "EPSG:4326 (WGS 84)",
            "sedona_index_type": "RTREE",
            "datasets": {name: ds.to_dict() for name, ds in self._datasets.items()},
            "registered_queries": len(self._sedona_queries),
        }

    def list_queries(self) -> list[dict]:
        return self._sedona_queries
