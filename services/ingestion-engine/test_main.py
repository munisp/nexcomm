"""Tests for NEXCOM Universal Ingestion Engine."""
import pytest
from fastapi.testclient import TestClient
from main import app


client = TestClient(app)


class TestHealth:
    def test_health_endpoint(self):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["data"]["service"] == "nexcom-ingestion-engine"
        assert data["data"]["feeds"]["total"] > 0

    def test_health_has_pipeline_info(self):
        resp = client.get("/health")
        data = resp.json()["data"]
        assert "pipeline" in data
        assert "flink" in data["pipeline"]
        assert "spark" in data["pipeline"]

    def test_health_has_lakehouse_info(self):
        resp = client.get("/health")
        data = resp.json()["data"]
        assert "lakehouse" in data
        assert "bronze" in data["lakehouse"]
        assert "silver" in data["lakehouse"]
        assert "gold" in data["lakehouse"]


class TestFeeds:
    def test_list_feeds(self):
        resp = client.get("/api/v1/feeds")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["data"]["total"] > 0
        assert len(data["data"]["feeds"]) > 0

    def test_list_feeds_by_category(self):
        resp = client.get("/api/v1/feeds?category=internal_exchange")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True

    def test_feed_status(self):
        # Get first feed ID
        feeds_resp = client.get("/api/v1/feeds")
        feeds = feeds_resp.json()["data"]["feeds"]
        if feeds:
            feed_id = feeds[0]["feed_id"]
            resp = client.get(f"/api/v1/feeds/{feed_id}/status")
            assert resp.status_code == 200

    def test_feed_status_not_found(self):
        resp = client.get("/api/v1/feeds/nonexistent-feed/status")
        assert resp.status_code == 404

    def test_start_feed(self):
        feeds_resp = client.get("/api/v1/feeds")
        feeds = feeds_resp.json()["data"]["feeds"]
        if feeds:
            feed_id = feeds[0]["feed_id"]
            resp = client.post(f"/api/v1/feeds/{feed_id}/start")
            assert resp.status_code == 200
            assert resp.json()["data"]["status"] == "started"

    def test_stop_feed(self):
        feeds_resp = client.get("/api/v1/feeds")
        feeds = feeds_resp.json()["data"]["feeds"]
        if feeds:
            feed_id = feeds[0]["feed_id"]
            # Start then stop
            client.post(f"/api/v1/feeds/{feed_id}/start")
            resp = client.post(f"/api/v1/feeds/{feed_id}/stop")
            assert resp.status_code == 200
            assert resp.json()["data"]["status"] == "stopped"

    def test_start_nonexistent_feed(self):
        resp = client.post("/api/v1/feeds/nonexistent/start")
        assert resp.status_code == 404

    def test_feed_metrics(self):
        resp = client.get("/api/v1/feeds/metrics")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True


class TestLakehouse:
    def test_lakehouse_status(self):
        resp = client.get("/api/v1/lakehouse/status")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert "bronze" in data
        assert "silver" in data
        assert "gold" in data
        assert "geospatial" in data

    def test_lakehouse_catalog(self):
        resp = client.get("/api/v1/lakehouse/catalog")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "tables" in data["data"]

    def test_lakehouse_catalog_by_layer(self):
        resp = client.get("/api/v1/lakehouse/catalog?layer=bronze")
        assert resp.status_code == 200

    def test_lakehouse_query_datafusion(self):
        resp = client.post("/api/v1/lakehouse/query", json={
            "sql": "SELECT * FROM trades LIMIT 10",
            "engine": "datafusion"
        })
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["engine"] == "datafusion"

    def test_lakehouse_query_spark(self):
        resp = client.post("/api/v1/lakehouse/query", json={
            "sql": "SELECT count(*) FROM orders",
            "engine": "spark"
        })
        assert resp.status_code == 200

    def test_lakehouse_query_invalid_engine(self):
        resp = client.post("/api/v1/lakehouse/query", json={
            "sql": "SELECT 1",
            "engine": "invalid"
        })
        assert resp.status_code == 400

    def test_data_lineage(self):
        resp = client.get("/api/v1/lakehouse/lineage/trades")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True


class TestSchemaRegistry:
    def test_list_schemas(self):
        resp = client.get("/api/v1/schema-registry")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["data"]["total"] > 0


class TestPipeline:
    def test_pipeline_status(self):
        resp = client.get("/api/v1/pipeline/status")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert "flink" in data
        assert "spark" in data

    def test_trigger_backfill(self):
        resp = client.post("/api/v1/pipeline/backfill", json={
            "feed_id": "int-orders",
            "start_date": "2026-01-01",
            "end_date": "2026-02-01",
            "parallelism": 4
        })
        assert resp.status_code == 200
