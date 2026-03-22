"""
NEXCOM Spatial Analytics Service — Apache Sedona + PostGIS
===========================================================
Exposes a lightweight HTTP API (Flask) that wraps Apache Sedona
spatial queries against the NEXCOM PostgreSQL/PostGIS database.

Endpoints:
  POST /spatial/nearby-farms        — find farms within radius_km of a point
  POST /spatial/farm-coverage       — compute total area covered by farm boundaries
  POST /spatial/farm-clusters       — DBSCAN spatial clustering of farm centroids
  POST /spatial/boundary-stats      — area, perimeter, centroid for a GeoJSON polygon
  GET  /spatial/state-heatmap       — farm density heatmap by state
  GET  /health                      — liveness check

All geometry is WGS-84 (SRID 4326). Distances use ST_DistanceSphere.
"""

import os
import json
import logging
from typing import Any

from flask import Flask, request, jsonify
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from sedona.spark import SedonaContext
from sedona.sql.types import GeometryType
from shapely.geometry import shape, mapping
from shapely import wkt as shapely_wkt
import psycopg2
import psycopg2.extras

# ─── Configuration ────────────────────────────────────────────────────────────

# Sedona service uses PostgreSQL with PostGIS extension.
# DATABASE_URL must be a postgresql:// or postgres:// URL.
# POSTGIS_URL can be set explicitly to use a separate PostGIS instance.
_raw_db_url = os.environ.get("DATABASE_URL", "")
if _raw_db_url.startswith("postgresql://") or _raw_db_url.startswith("postgres://"):
    DATABASE_URL = _raw_db_url
else:
    DATABASE_URL = os.environ.get(
        "POSTGIS_URL",
        "postgresql://nexcom:nexcom_secure_2026@localhost:5432/nexcom",
    )
SEDONA_PORT = int(os.environ.get("SEDONA_PORT", "7474"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("nexcom.sedona")

app = Flask(__name__)

# ─── Spark + Sedona Session ───────────────────────────────────────────────────

def _build_spark() -> SparkSession:
    """Build a local Spark session with Sedona and JDBC PostgreSQL support."""
    config = (
        SparkSession.builder.master("local[*]")
        .appName("NEXCOM-Sedona")
        .config("spark.serializer", "org.apache.spark.serializer.KryoSerializer")
        .config(
            "spark.kryo.registrator",
            "org.apache.sedona.core.serde.SedonaKryoRegistrator",
        )
        .config("spark.sql.extensions", "org.apache.sedona.sql.SedonaSqlExtensions")
        .config("spark.driver.memory", "1g")
        .config("spark.executor.memory", "1g")
        .config("spark.ui.enabled", "false")
    )
    raw = config.getOrCreate()
    return SedonaContext.create(raw)


_spark: SparkSession | None = None


def get_spark() -> SparkSession:
    global _spark
    if _spark is None:
        log.info("Initialising Spark + Sedona session …")
        _spark = _build_spark()
        log.info("Sedona session ready.")
    return _spark


# ─── PostGIS helpers ──────────────────────────────────────────────────────────

def _pg_conn():
    """Return a psycopg2 connection to the NEXCOM database."""
    return psycopg2.connect(DATABASE_URL)


def _load_farms_df(spark: SparkSession):
    """Load farm_profiles with PostGIS geometry into a Sedona DataFrame."""
    conn = _pg_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT
            fp.id,
            fp.user_id,
            fp.farm_name,
            fp.size_hectares,
            fp.state,
            fp.lga,
            fp.soil_type,
            fp.description,
            ST_AsText(fp.centroid) AS centroid_wkt,
            ST_AsText(fp.geom)     AS geom_wkt,
            ST_AsGeoJSON(fp.centroid)::text AS centroid_geojson,
            ST_AsGeoJSON(fp.geom)::text     AS geom_geojson,
            fp.latitude::float  AS latitude,
            fp.longitude::float AS longitude,
            fp.created_at::text AS created_at
        FROM farm_profiles fp
        WHERE fp.centroid IS NOT NULL OR fp.geom IS NOT NULL
        """
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()

    if not rows:
        return None

    # Convert to Spark DataFrame
    data = [dict(r) for r in rows]
    df = spark.createDataFrame(data)

    # Register geometry columns
    if "centroid_wkt" in df.columns:
        df = df.withColumn("centroid_geom", F.expr("ST_GeomFromWKT(centroid_wkt)"))
    if "geom_wkt" in df.columns:
        df = df.withColumn("boundary_geom", F.expr("ST_GeomFromWKT(geom_wkt)"))

    return df


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "nexcom-sedona", "version": "1.0.0"})


@app.post("/spatial/nearby-farms")
def nearby_farms():
    """
    Find farms whose centroid is within `radius_km` of the given point.
    Body: { lat: float, lng: float, radius_km: float }
    """
    body = request.get_json(force=True)
    lat = float(body.get("lat", 0))
    lng = float(body.get("lng", 0))
    radius_km = float(body.get("radius_km", 50))

    spark = get_spark()
    df = _load_farms_df(spark)
    if df is None:
        return jsonify({"farms": [], "count": 0})

    df.createOrReplaceTempView("farms")
    query_point_wkt = f"POINT({lng} {lat})"

    result = spark.sql(
        f"""
        SELECT
            id, farm_name, state, lga, size_hectares, soil_type,
            latitude, longitude, centroid_geojson, geom_geojson,
            ROUND(ST_DistanceSphere(
                centroid_geom,
                ST_GeomFromWKT('SRID=4326;{query_point_wkt}')
            ) / 1000.0, 3) AS distance_km
        FROM farms
        WHERE centroid_geom IS NOT NULL
          AND ST_DistanceSphere(
                centroid_geom,
                ST_GeomFromWKT('SRID=4326;{query_point_wkt}')
              ) <= {radius_km * 1000}
        ORDER BY distance_km ASC
        """
    )
    rows = [r.asDict() for r in result.collect()]
    return jsonify({"farms": rows, "count": len(rows), "radius_km": radius_km})


@app.post("/spatial/farm-coverage")
def farm_coverage():
    """
    Compute total area (ha) and union polygon of all farm boundaries.
    Optional body: { state: str } to filter by state.
    """
    body = request.get_json(force=True) or {}
    state_filter = body.get("state")

    conn = _pg_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    where = "WHERE geom IS NOT NULL"
    params: list[Any] = []
    if state_filter:
        where += " AND state = %s"
        params.append(state_filter)

    cur.execute(
        f"""
        SELECT
            COUNT(*)                                              AS farm_count,
            ROUND(SUM(size_hectares)::numeric, 2)                AS total_declared_ha,
            ROUND((ST_Area(ST_Union(geom)::geography) / 10000)::numeric, 2) AS total_measured_ha,
            ST_AsGeoJSON(ST_Union(geom))::text                   AS union_geojson
        FROM farm_profiles
        {where}
        """,
        params,
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    return jsonify(
        {
            "farm_count": int(row["farm_count"]) if row else 0,
            "total_declared_ha": float(row["total_declared_ha"] or 0) if row else 0,
            "total_measured_ha": float(row["total_measured_ha"] or 0) if row else 0,
            "union_geojson": json.loads(row["union_geojson"]) if row and row["union_geojson"] else None,
            "state_filter": state_filter,
        }
    )


@app.post("/spatial/farm-clusters")
def farm_clusters():
    """
    DBSCAN spatial clustering of farm centroids.
    Body: { eps_km: float (default 20), min_samples: int (default 2) }
    Returns cluster assignments per farm.
    """
    body = request.get_json(force=True) or {}
    eps_km = float(body.get("eps_km", 20))
    min_samples = int(body.get("min_samples", 2))

    spark = get_spark()
    df = _load_farms_df(spark)
    if df is None:
        return jsonify({"clusters": [], "cluster_count": 0})

    df.createOrReplaceTempView("farms")

    # Use ST_ClusterDBSCAN via PostGIS (more reliable than Sedona DBSCAN for small datasets)
    conn = _pg_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT
            id,
            farm_name,
            state,
            lga,
            latitude::float,
            longitude::float,
            ST_ClusterDBSCAN(centroid, eps := %s, minpoints := %s)
                OVER () AS cluster_id
        FROM farm_profiles
        WHERE centroid IS NOT NULL
        ORDER BY cluster_id NULLS LAST, id
        """,
        (eps_km / 111.0, min_samples),  # convert km to degrees (~111 km/degree)
    )
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()

    cluster_count = len({r["cluster_id"] for r in rows if r["cluster_id"] is not None})
    return jsonify({"clusters": rows, "cluster_count": cluster_count, "eps_km": eps_km})


@app.post("/spatial/boundary-stats")
def boundary_stats():
    """
    Compute area, perimeter, and centroid for a submitted GeoJSON polygon.
    Body: { geojson: GeoJSON Polygon or Feature }
    """
    body = request.get_json(force=True)
    geojson = body.get("geojson")
    if not geojson:
        return jsonify({"error": "geojson is required"}), 400

    # Normalise to geometry
    if geojson.get("type") == "Feature":
        geojson = geojson["geometry"]

    conn = _pg_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT
            ROUND((ST_Area(ST_GeomFromGeoJSON(%s)::geography) / 10000)::numeric, 4) AS area_ha,
            ROUND((ST_Perimeter(ST_GeomFromGeoJSON(%s)::geography) / 1000)::numeric, 3) AS perimeter_km,
            ST_AsGeoJSON(ST_Centroid(ST_GeomFromGeoJSON(%s)))::text AS centroid_geojson,
            ST_X(ST_Centroid(ST_GeomFromGeoJSON(%s)))::float AS centroid_lng,
            ST_Y(ST_Centroid(ST_GeomFromGeoJSON(%s)))::float AS centroid_lat
        """,
        [json.dumps(geojson)] * 5,
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    return jsonify(
        {
            "area_ha": float(row["area_ha"]) if row else None,
            "perimeter_km": float(row["perimeter_km"]) if row else None,
            "centroid": {
                "lat": float(row["centroid_lat"]) if row else None,
                "lng": float(row["centroid_lng"]) if row else None,
                "geojson": json.loads(row["centroid_geojson"]) if row and row["centroid_geojson"] else None,
            },
        }
    )


@app.get("/spatial/state-heatmap")
def state_heatmap():
    """
    Farm density heatmap grouped by state.
    Returns: [ { state, farm_count, total_ha, avg_size_ha, centroid_lat, centroid_lng } ]
    """
    conn = _pg_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT
            state,
            COUNT(*) AS farm_count,
            ROUND(SUM(size_hectares)::numeric, 2) AS total_ha,
            ROUND(AVG(size_hectares)::numeric, 2) AS avg_size_ha,
            ROUND(AVG(latitude::float)::numeric, 5) AS centroid_lat,
            ROUND(AVG(longitude::float)::numeric, 5) AS centroid_lng
        FROM farm_profiles
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        GROUP BY state
        ORDER BY farm_count DESC
        """
    )
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return jsonify({"heatmap": rows, "state_count": len(rows)})


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info(f"Starting NEXCOM Sedona service on port {SEDONA_PORT} …")
    app.run(host="0.0.0.0", port=SEDONA_PORT, debug=False)
