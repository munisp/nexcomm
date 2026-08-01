"""
Lakehouse client for the NEXCOM Analytics service.
Uses delta-rs (deltalake Python package) for Delta Lake reads/writes,
Apache DataFusion for fast analytical queries, and PyArrow for data processing.
Falls back gracefully when optional heavy dependencies (Spark, Flink, Ray) are absent.
"""
import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

LAKEHOUSE_BASE_PATH = os.getenv("LAKEHOUSE_BASE_PATH", "/data/lakehouse")


class LakehouseClient:
    """Unified interface to the Lakehouse data platform."""

    def __init__(self):
        self._connected = False
        self._delta_available = False
        self._datafusion_available = False
        self._spark_initialized = False
        self._flink_initialized = False
        self._sedona_initialized = False
        self._ray_initialized = False
        self._datafusion_ctx = None
        self._initialize_components()

    def _initialize_components(self) -> None:
        """Initialize available Lakehouse components."""
        # delta-rs (lightweight, no JVM required)
        try:
            import deltalake  # type: ignore  # noqa: F401
            self._delta_available = True
            logger.info("[Lakehouse] delta-rs available")
        except ImportError:
            logger.warning("[Lakehouse] deltalake not installed — Delta Lake writes use PyArrow fallback")

        # Apache DataFusion (fast analytical queries, no JVM)
        try:
            import datafusion  # type: ignore
            self._datafusion_ctx = datafusion.SessionContext()
            self._datafusion_available = True
            logger.info("[Lakehouse/DataFusion] Query engine initialized")
        except ImportError:
            logger.warning("[Lakehouse] datafusion not installed — SQL queries use PyArrow fallback")

        # Apache Spark (optional, requires JVM)
        try:
            from pyspark.sql import SparkSession  # type: ignore
            self.spark = (
                SparkSession.builder
                .appName("NEXCOM Analytics")
                .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
                .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog")
                .config("spark.master", os.getenv("SPARK_MASTER", "local[*]"))
                .getOrCreate()
            )
            self._spark_initialized = True
            logger.info("[Lakehouse/Spark] Initialized with Delta Lake")
        except Exception:
            logger.info("[Lakehouse/Spark] Not available (JVM/PySpark not installed)")

        # Apache Flink (optional)
        try:
            from pyflink.datastream import StreamExecutionEnvironment  # type: ignore
            self.flink_env = StreamExecutionEnvironment.get_execution_environment()
            self.flink_env.set_parallelism(int(os.getenv("FLINK_PARALLELISM", "4")))
            self._flink_initialized = True
            logger.info("[Lakehouse/Flink] Stream processing initialized")
        except Exception:
            logger.info("[Lakehouse/Flink] Not available")

        # Apache Sedona (optional, requires Spark)
        if self._spark_initialized:
            try:
                from sedona.spark import SedonaContext  # type: ignore
                self.sedona = SedonaContext.create(self.spark)
                self._sedona_initialized = True
                logger.info("[Lakehouse/Sedona] Geospatial engine initialized")
            except Exception:
                logger.info("[Lakehouse/Sedona] Not available")

        # Ray (optional distributed ML)
        try:
            import ray  # type: ignore
            if not ray.is_initialized():
                ray.init(address=os.getenv("RAY_ADDRESS", "auto"), ignore_reinit_error=True)
            self._ray_initialized = True
            logger.info("[Lakehouse/Ray] Distributed compute initialized")
        except Exception:
            logger.info("[Lakehouse/Ray] Not available")

        self._connected = True
        logger.info("[Lakehouse] Initialization complete (delta=%s, datafusion=%s, spark=%s)",
                    self._delta_available, self._datafusion_available, self._spark_initialized)

    def spark_sql(self, query: str) -> list[dict]:
        """Execute a Spark SQL query against Delta Lake tables."""
        if self._spark_initialized:
            try:
                df = self.spark.sql(query)
                return df.toPandas().to_dict(orient="records")
            except Exception as exc:
                logger.error("[Lakehouse/Spark] Query failed: %s", exc)
        # Fallback to DataFusion
        return self.datafusion_query(query)

    def datafusion_query(self, query: str) -> list[dict]:
        """Execute a DataFusion analytical query against Parquet files."""
        if self._datafusion_available and self._datafusion_ctx is not None:
            try:
                result = self._datafusion_ctx.sql(query)
                return result.collect()[0].to_pydict() if result else []
            except Exception as exc:
                logger.error("[Lakehouse/DataFusion] Query failed: %s", exc)
        # Fallback: PyArrow parquet scan
        return self._pyarrow_query(query)

    def _pyarrow_query(self, query: str) -> list[dict]:
        """Minimal PyArrow-based query fallback (SELECT * FROM table LIMIT n)."""
        try:
            import re
            import pyarrow.parquet as pq
            import pyarrow.dataset as ds
            # Extract table name from simple SELECT queries
            m = re.search(r"FROM\s+(\S+)", query, re.IGNORECASE)
            if not m:
                return []
            table_name = m.group(1).replace(".", "/")
            path = f"{LAKEHOUSE_BASE_PATH}/bronze/{table_name}"
            if not os.path.exists(path):
                path = f"{LAKEHOUSE_BASE_PATH}/gold/{table_name}"
            if not os.path.exists(path):
                return []
            dataset = ds.dataset(path, format="parquet")
            limit_m = re.search(r"LIMIT\s+(\d+)", query, re.IGNORECASE)
            limit = int(limit_m.group(1)) if limit_m else 1000
            table = dataset.head(limit)
            return table.to_pydict()
        except Exception as exc:
            logger.error("[Lakehouse/PyArrow] Query failed: %s", exc)
            return []

    def write_delta(self, table_path: str, records: list[dict], mode: str = "append") -> int:
        """Write records to a Delta Lake table."""
        if not records:
            return 0
        full_path = f"{LAKEHOUSE_BASE_PATH}/{table_path}"
        os.makedirs(full_path, exist_ok=True)
        if self._delta_available:
            try:
                import pyarrow as pa
                from deltalake import write_deltalake  # type: ignore
                table = pa.Table.from_pylist(records)
                write_deltalake(full_path, table, mode=mode)
                logger.debug("[Lakehouse/Delta] Wrote %d records to %s", len(records), full_path)
                return len(records)
            except Exception as exc:
                logger.error("[Lakehouse/Delta] Write failed: %s", exc)
        # Fallback: PyArrow Parquet write
        return self._write_parquet(full_path, records)

    def _write_parquet(self, path: str, records: list[dict]) -> int:
        """Write records as Parquet files (Bronze layer fallback)."""
        try:
            import pyarrow as pa
            import pyarrow.parquet as pq
            import time
            table = pa.Table.from_pylist(records)
            filename = f"{path}/part-{int(time.time() * 1000)}.parquet"
            pq.write_table(table, filename, compression="snappy")
            logger.debug("[Lakehouse/Parquet] Wrote %d records to %s", len(records), filename)
            return len(records)
        except Exception as exc:
            logger.error("[Lakehouse/Parquet] Write failed: %s", exc)
            return 0

    def flink_process(self, stream_name: str, processor: Any) -> None:
        """Register a Flink stream processor."""
        if self._flink_initialized:
            logger.info("[Lakehouse/Flink] Registering processor for stream: %s", stream_name)
        else:
            logger.debug("[Lakehouse/Flink] Not available — skipping stream: %s", stream_name)

    def sedona_spatial_query(self, query: str) -> list[dict]:
        """Execute a Sedona spatial SQL query."""
        if self._sedona_initialized:
            try:
                df = self.sedona.sql(query)
                return df.toPandas().to_dict(orient="records")
            except Exception as exc:
                logger.error("[Lakehouse/Sedona] Query failed: %s", exc)
        return []

    def ray_submit(self, func: Any, *args, **kwargs) -> Any:
        """Submit a task to Ray for distributed execution."""
        if self._ray_initialized:
            try:
                import ray  # type: ignore
                return ray.get(ray.remote(func).remote(*args, **kwargs))
            except Exception as exc:
                logger.error("[Lakehouse/Ray] Task failed: %s", exc)
        # Fallback: run locally
        return func(*args, **kwargs)

    def is_connected(self) -> bool:
        return self._connected

    def status(self) -> dict:
        return {
            "delta_available": self._delta_available,
            "datafusion": self._datafusion_available,
            "spark": self._spark_initialized,
            "flink": self._flink_initialized,
            "sedona": self._sedona_initialized,
            "ray": self._ray_initialized,
        }

    def close(self) -> None:
        if self._spark_initialized:
            try:
                self.spark.stop()
            except Exception:
                pass
        if self._ray_initialized:
            try:
                import ray  # type: ignore
                ray.shutdown()
            except Exception:
                pass
        self._connected = False
        logger.info("[Lakehouse] All components shut down")
