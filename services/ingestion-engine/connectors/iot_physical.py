"""
IoT & Physical Infrastructure Connectors — 4 feeds from warehouse sensors,
fleet tracking, port operations, and quality assurance systems.

These feeds are critical for NEXCOM's physical delivery infrastructure,
supporting the 9 certified warehouses across Africa, London, and Dubai.

Feed Map:
  ┌───────────────────────────────────────────────────────────────────┐
  │               IOT & PHYSICAL INFRASTRUCTURE                       │
  │                                                                   │
  │  Warehouse ─── IoT Sensors ───── Temperature, Humidity, Weight   │
  │  Fleet ─────── GPS Tracking ──── Delivery Vehicles, Rail Cars    │
  │  Ports ─────── Port Systems ──── Container Movements, Berths     │
  │  QA ────────── Lab Systems ───── Grade Testing, Quality Certs    │
  └───────────────────────────────────────────────────────────────────┘
"""

from connectors.registry import (
    ConnectorRegistry,
    FeedConnector,
    FeedCategory,
    FeedProtocol,
    FeedStatus,
    FeedMetrics,
)


class IoTPhysicalConnectors:
    """Registers all 4 IoT and physical infrastructure feed connectors."""

    @staticmethod
    def register(registry: ConnectorRegistry):
        feeds = [
            FeedConnector(
                feed_id="iot-warehouse-sensors",
                name="Warehouse IoT Sensors",
                description=(
                    "Real-time sensor data from 9 NEXCOM-certified warehouses: "
                    "Nairobi (10,000 MT), Mombasa (25,000 MT), Dar es Salaam "
                    "(15,000 MT), Addis Ababa (8,000 MT), Lagos (20,000 MT), "
                    "Accra (12,000 MT), Johannesburg (18,000 MT), London (50,000 MT), "
                    "Dubai (30,000 MT). Sensors: temperature (critical for coffee, "
                    "cocoa), humidity, weight scales, door open/close, fire/smoke, "
                    "pest detection. Data used for commodity grading and insurance."
                ),
                category=FeedCategory.IOT_PHYSICAL,
                protocol=FeedProtocol.MQTT,
                source_endpoint="mqtt://iot.nexcom.exchange:1883 (per-warehouse topics)",
                kafka_topic="nexcom.ingest.iot-sensors",
                lakehouse_target="bronze/iot/warehouse_sensors",
                schema_name="warehouse_sensor_v1",
                refresh_interval_sec=30,
                status=FeedStatus.ACTIVE,
                priority=2,
                metrics=FeedMetrics(
                    messages_received=25_920_000,
                    messages_processed=25_920_000,
                    bytes_received=5_184_000_000,
                    avg_latency_ms=50.0,
                    throughput_msg_sec=300,
                ),
                tags=["real-time", "iot", "warehouse", "physical-delivery"],
            ),
            FeedConnector(
                feed_id="iot-fleet-gps",
                name="GPS Fleet Tracking",
                description=(
                    "Real-time GPS positions and telemetry from delivery fleet: "
                    "trucks, rail cars, and container vessels transporting physical "
                    "commodities between warehouses and delivery points. "
                    "Data: lat/lon, speed, heading, fuel level, cargo temperature, "
                    "estimated arrival time. Geofence alerts for delivery zones."
                ),
                category=FeedCategory.IOT_PHYSICAL,
                protocol=FeedProtocol.MQTT,
                source_endpoint="mqtt://fleet.nexcom.exchange:1883",
                kafka_topic="nexcom.ingest.fleet-gps",
                lakehouse_target="bronze/iot/fleet_tracking",
                schema_name="fleet_gps_v1",
                refresh_interval_sec=10,
                status=FeedStatus.ACTIVE,
                priority=3,
                metrics=FeedMetrics(
                    messages_received=8_640_000,
                    messages_processed=8_640_000,
                    bytes_received=1_728_000_000,
                    avg_latency_ms=100.0,
                    throughput_msg_sec=100,
                ),
                tags=["real-time", "iot", "geospatial", "logistics"],
            ),
            FeedConnector(
                feed_id="iot-port-throughput",
                name="Port Operations & Throughput",
                description=(
                    "Port operational data from key African commodity ports: "
                    "Mombasa (Kenya), Dar es Salaam (Tanzania), Lagos/Apapa (Nigeria), "
                    "Durban (South Africa), Djibouti. Data: container movements, "
                    "berth occupancy, vessel queue length, crane utilization, "
                    "customs clearance times. Used for supply chain scoring "
                    "and delivery time estimation."
                ),
                category=FeedCategory.IOT_PHYSICAL,
                protocol=FeedProtocol.REST_POLL,
                source_endpoint="port authority APIs + AIS-derived port data",
                kafka_topic="nexcom.ingest.port-throughput",
                lakehouse_target="bronze/iot/port_operations",
                schema_name="port_throughput_v1",
                refresh_interval_sec=3600,  # hourly
                status=FeedStatus.ACTIVE,
                priority=3,
                metrics=FeedMetrics(
                    messages_received=8760,
                    messages_processed=8760,
                    bytes_received=43_800_000,
                    avg_latency_ms=500.0,
                    throughput_msg_sec=0.002,
                ),
                tags=["hourly", "geospatial", "logistics", "supply-chain"],
            ),
            FeedConnector(
                feed_id="iot-quality-assurance",
                name="Quality Assurance & Grading",
                description=(
                    "Lab test results and commodity grading data from certified "
                    "inspection agencies: SGS, Bureau Veritas, Intertek. "
                    "Covers: moisture content, protein levels (wheat), cup scores "
                    "(coffee), fat content (cocoa), purity (gold, silver), "
                    "sulfur content (crude oil). Linked to warehouse receipts "
                    "for grade certification and pricing differentials."
                ),
                category=FeedCategory.IOT_PHYSICAL,
                protocol=FeedProtocol.REST_POLL,
                source_endpoint="api.sgs.com + api.bureauveritas.com (inspection results)",
                kafka_topic="nexcom.ingest.quality-assurance",
                lakehouse_target="bronze/iot/quality_assurance",
                schema_name="quality_test_v1",
                refresh_interval_sec=3600,
                status=FeedStatus.ACTIVE,
                priority=2,
                metrics=FeedMetrics(
                    messages_received=5000,
                    messages_processed=5000,
                    bytes_received=25_000_000,
                    avg_latency_ms=200.0,
                ),
                tags=["scheduled", "physical-delivery", "grading", "quality"],
            ),
        ]

        for feed in feeds:
            registry.register(feed)
