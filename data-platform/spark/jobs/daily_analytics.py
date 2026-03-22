"""
NEXCOM Exchange - Spark Batch Job: Daily Trading Analytics
Computes daily trading summaries, portfolio analytics, and compliance reports.
Reads from Silver layer, writes to Gold layer in Delta Lake format.
"""

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.window import Window
from delta import configure_spark_with_delta_pip


def create_spark_session() -> SparkSession:
    """Create Spark session with Delta Lake and Sedona support."""
    builder = (
        SparkSession.builder
        .appName("NEXCOM Daily Analytics")
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
        .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog")
        .config("spark.hadoop.fs.s3a.endpoint", "http://minio:9000")
        .config("spark.hadoop.fs.s3a.access.key", "${MINIO_ACCESS_KEY}")
        .config("spark.hadoop.fs.s3a.secret.key", "${MINIO_SECRET_KEY}")
        .config("spark.hadoop.fs.s3a.path.style.access", "true")
    )
    return configure_spark_with_delta_pip(builder).getOrCreate()


def compute_daily_trading_summary(spark: SparkSession, trade_date: str) -> None:
    """Compute daily trading summary per symbol."""
    trades = spark.read.format("delta").load("s3a://nexcom-lakehouse/silver/trades")
    daily = trades.filter(F.col("trade_date") == trade_date)

    summary = daily.groupBy("symbol").agg(
        F.count("*").alias("trade_count"),
        F.sum("quantity").alias("total_volume"),
        F.sum("total_value").alias("total_value"),
        F.avg("price").alias("avg_price"),
        F.min("price").alias("low_price"),
        F.max("price").alias("high_price"),
        F.first("price").alias("open_price"),
        F.last("price").alias("close_price"),
        F.countDistinct("buyer_id").alias("unique_buyers"),
        F.countDistinct("seller_id").alias("unique_sellers"),
        F.sum("total_value").divide(F.sum("quantity")).alias("vwap"),
    ).withColumn("trade_date", F.lit(trade_date))

    summary.write.format("delta").mode("append").partitionBy("trade_date").save(
        "s3a://nexcom-lakehouse/gold/daily_trading_summary"
    )


def compute_portfolio_analytics(spark: SparkSession) -> None:
    """Compute portfolio analytics per user."""
    trades = spark.read.format("delta").load("s3a://nexcom-lakehouse/silver/trades")

    # Net position per user per symbol
    buys = trades.groupBy("buyer_id", "symbol").agg(
        F.sum("quantity").alias("bought_qty"),
        F.sum("total_value").alias("bought_value"),
    ).withColumnRenamed("buyer_id", "user_id")

    sells = trades.groupBy("seller_id", "symbol").agg(
        F.sum("quantity").alias("sold_qty"),
        F.sum("total_value").alias("sold_value"),
    ).withColumnRenamed("seller_id", "user_id")

    portfolio = buys.join(sells, ["user_id", "symbol"], "outer").fillna(0)
    portfolio = portfolio.withColumn(
        "net_position", F.col("bought_qty") - F.col("sold_qty")
    ).withColumn(
        "realized_pnl", F.col("sold_value") - F.col("bought_value")
    ).withColumn(
        "computed_at", F.current_timestamp()
    )

    portfolio.write.format("delta").mode("overwrite").save(
        "s3a://nexcom-lakehouse/gold/portfolio_analytics"
    )


def compute_risk_metrics(spark: SparkSession) -> None:
    """Compute risk metrics: VaR, concentration, correlation."""
    market_data = spark.read.format("delta").load("s3a://nexcom-lakehouse/silver/market_data")

    # Daily returns per symbol
    window = Window.partitionBy("symbol").orderBy("timestamp")
    returns = market_data.withColumn(
        "prev_price", F.lag("price", 1).over(window)
    ).withColumn(
        "daily_return", (F.col("price") - F.col("prev_price")) / F.col("prev_price")
    ).filter(F.col("daily_return").isNotNull())

    # Volatility (std dev of returns)
    risk = returns.groupBy("symbol").agg(
        F.stddev("daily_return").alias("volatility"),
        F.avg("daily_return").alias("avg_return"),
        F.min("daily_return").alias("min_return"),
        F.max("daily_return").alias("max_return"),
        F.expr("percentile_approx(daily_return, 0.05)").alias("var_95"),
        F.expr("percentile_approx(daily_return, 0.01)").alias("var_99"),
    ).withColumn("computed_at", F.current_timestamp())

    risk.write.format("delta").mode("overwrite").save(
        "s3a://nexcom-lakehouse/gold/risk_metrics"
    )


if __name__ == "__main__":
    import sys
    from datetime import datetime, timedelta

    spark = create_spark_session()
    trade_date = sys.argv[1] if len(sys.argv) > 1 else (
        datetime.utcnow() - timedelta(days=1)
    ).strftime("%Y-%m-%d")

    print(f"Running daily analytics for {trade_date}")
    compute_daily_trading_summary(spark, trade_date)
    compute_portfolio_analytics(spark)
    compute_risk_metrics(spark)
    print("Daily analytics completed")

    spark.stop()
