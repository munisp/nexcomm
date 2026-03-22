"""
NEXCOM Exchange - Apache Sedona Geospatial Analytics
Supply chain mapping, warehouse proximity analysis, and trade route optimization.
Integrates with the Lakehouse architecture for geospatial commodity intelligence.
"""

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from sedona.spark import SedonaContext


def create_sedona_session() -> SparkSession:
    """Create Spark session with Sedona geospatial extensions."""
    spark = (
        SparkSession.builder
        .appName("NEXCOM Geospatial Analytics")
        .config("spark.sql.extensions",
                "io.delta.sql.DeltaSparkSessionExtension,"
                "org.apache.sedona.viz.sql.SedonaVizRegistrator,"
                "org.apache.sedona.sql.SedonaSqlExtensions")
        .config("spark.serializer", "org.apache.spark.serializer.KryoSerializer")
        .config("spark.kryo.registrator", "org.apache.sedona.core.serde.SedonaKryoRegistrator")
        .getOrCreate()
    )
    return SedonaContext.create(spark)


def compute_warehouse_proximity(spark: SparkSession) -> None:
    """
    Compute proximity of trade participants to commodity warehouses.
    Helps optimize delivery logistics and storage allocation.
    """
    # Load warehouse locations (GeoJSON)
    warehouses = spark.sql("""
        SELECT
            warehouse_id,
            name,
            commodity_types,
            capacity_mt,
            ST_Point(longitude, latitude) AS location
        FROM warehouse_locations
    """)

    # Load trade participant locations
    participants = spark.sql("""
        SELECT
            user_id,
            user_type,
            ST_Point(longitude, latitude) AS location
        FROM user_locations
        WHERE longitude IS NOT NULL AND latitude IS NOT NULL
    """)

    # Spatial join: find nearest warehouse for each participant
    proximity = spark.sql("""
        SELECT
            p.user_id,
            p.user_type,
            w.warehouse_id,
            w.name AS warehouse_name,
            ST_Distance(p.location, w.location) AS distance_km,
            w.commodity_types,
            w.capacity_mt
        FROM user_locations p
        CROSS JOIN warehouse_locations w
        WHERE ST_Distance(p.location, w.location) < 500
        ORDER BY p.user_id, distance_km
    """)

    proximity.write.format("delta").mode("overwrite").save(
        "s3a://nexcom-lakehouse/gold/warehouse_proximity"
    )


def compute_trade_flow_corridors(spark: SparkSession) -> None:
    """
    Analyze commodity trade flow corridors between regions.
    Identifies high-volume trade routes for infrastructure planning.
    """
    trade_flows = spark.sql("""
        SELECT
            t.symbol,
            buyer_loc.country AS buyer_country,
            seller_loc.country AS seller_country,
            ST_Point(buyer_loc.longitude, buyer_loc.latitude) AS buyer_point,
            ST_Point(seller_loc.longitude, seller_loc.latitude) AS seller_point,
            SUM(t.quantity) AS total_volume,
            COUNT(*) AS trade_count,
            ST_Distance(
                ST_Point(buyer_loc.longitude, buyer_loc.latitude),
                ST_Point(seller_loc.longitude, seller_loc.latitude)
            ) AS corridor_distance_km
        FROM silver_trades t
        JOIN user_locations buyer_loc ON t.buyer_id = buyer_loc.user_id
        JOIN user_locations seller_loc ON t.seller_id = seller_loc.user_id
        GROUP BY t.symbol, buyer_loc.country, seller_loc.country,
                 buyer_loc.longitude, buyer_loc.latitude,
                 seller_loc.longitude, seller_loc.latitude
    """)

    trade_flows.write.format("delta").mode("overwrite").save(
        "s3a://nexcom-lakehouse/gold/trade_flow_corridors"
    )


def compute_agricultural_zones(spark: SparkSession) -> None:
    """
    Map agricultural production zones and correlate with exchange activity.
    Uses polygon-based spatial analysis for crop-growing regions.
    """
    # In production: Load shapefiles for agricultural zones
    # Use Sedona's ST_GeomFromWKT for polygon-based analysis
    # Correlate with weather data, satellite imagery, and yield forecasts
    pass


if __name__ == "__main__":
    spark = create_sedona_session()

    print("Computing warehouse proximity analysis...")
    compute_warehouse_proximity(spark)

    print("Computing trade flow corridors...")
    compute_trade_flow_corridors(spark)

    print("Computing agricultural zone analysis...")
    compute_agricultural_zones(spark)

    print("Geospatial analytics completed")
    spark.stop()
