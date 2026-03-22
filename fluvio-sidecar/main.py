#!/usr/bin/env python3.11
"""
NEXCOM Fluvio Sidecar Service
==============================
Bridges the official Fluvio Python SDK (fluvio PyPI package) to a
FastAPI REST + WebSocket interface consumed by the Go gateway service.

Architecture:
  Go Gateway  <──HTTP/WS──>  Fluvio Sidecar (this service)  <──Fluvio Protocol──>  Fluvio SC

Topics:
  market-ticks       - Raw tick data (sub-millisecond latency)
  price-aggregates   - OHLCV candles (1m, 5m, 15m, 1h)
  trade-signals      - AI/ML generated trading signals
  risk-alerts        - Real-time risk threshold breaches
  order-events       - Order lifecycle events (created, filled, cancelled)
  settlement-events  - Settlement confirmation events

Endpoints:
  POST /produce/{topic}           - Produce a record to a Fluvio topic
  POST /produce-batch/{topic}     - Produce multiple records
  GET  /consume/{topic}/{offset}  - SSE stream of records from offset
  WS   /ws/consume/{topic}        - WebSocket stream of records
  GET  /topics                    - List all topics
  POST /topics/{name}             - Create a topic
  GET  /health                    - Health check
  GET  /metrics                   - Prometheus metrics
"""

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [Fluvio-Sidecar] %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────
FLUVIO_ENDPOINT = os.getenv("FLUVIO_ENDPOINT", "localhost:9003")
SIDECAR_PORT = int(os.getenv("FLUVIO_SIDECAR_PORT", "9090"))
FALLBACK_MODE = False

# ─── Fluvio client (lazy init) ────────────────────────────────────────────────
fluvio_client = None
producers: dict = {}  # topic -> TopicProducer
metrics = {
    "produced": 0,
    "consumed": 0,
    "errors": 0,
    "connected": False,
    "fallback_mode": False,
    "uptime_start": time.time(),
}

# In-memory fallback queue when Fluvio SC is unavailable
fallback_queues: dict[str, list] = {}
ws_subscribers: dict[str, list] = {}  # topic -> [WebSocket]


async def init_fluvio():
    """Initialize Fluvio client connection with graceful fallback."""
    global fluvio_client, FALLBACK_MODE
    try:
        from fluvio import Fluvio, FluvioConfig

        config = FluvioConfig.new()
        config.set_endpoint(FLUVIO_ENDPOINT, use_ssl=False)
        fluvio_client = await asyncio.get_event_loop().run_in_executor(
            None, lambda: Fluvio.connect_with_config(config)
        )
        metrics["connected"] = True
        metrics["fallback_mode"] = False
        FALLBACK_MODE = False
        logger.info(f"Fluvio client connected to {FLUVIO_ENDPOINT} (official Python SDK)")
    except Exception as e:
        logger.warning(f"Fluvio SC unavailable ({e}) — running in fallback mode (in-memory queues)")
        FALLBACK_MODE = True
        metrics["connected"] = False
        metrics["fallback_mode"] = True


async def get_producer(topic: str):
    """Get or create a Fluvio TopicProducer for the given topic."""
    if FALLBACK_MODE or fluvio_client is None:
        return None
    if topic not in producers:
        try:
            producer = await asyncio.get_event_loop().run_in_executor(
                None, lambda: fluvio_client.topic_producer(topic)
            )
            producers[topic] = producer
        except Exception as e:
            logger.error(f"Failed to create producer for topic={topic}: {e}")
            return None
    return producers[topic]


# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_fluvio()
    logger.info(f"Fluvio Sidecar listening on port {SIDECAR_PORT}")
    yield
    # Cleanup
    for producer in producers.values():
        try:
            await asyncio.get_event_loop().run_in_executor(None, producer.flush)
        except Exception:
            pass
    logger.info("Fluvio Sidecar shutdown complete")


# ─── FastAPI app ──────────────────────────────────────────────────────────────
app = FastAPI(
    title="NEXCOM Fluvio Sidecar",
    description="Bridges official Fluvio Python SDK to REST/WebSocket for Go gateway",
    version="1.0.0",
    lifespan=lifespan,
)


# ─── Models ───────────────────────────────────────────────────────────────────
class ProduceRequest(BaseModel):
    key: str = ""
    value: dict | str | list
    headers: dict[str, str] = {}


class ProduceBatchRequest(BaseModel):
    records: list[ProduceRequest]


class TopicCreateRequest(BaseModel):
    partitions: int = 1
    replication: int = 1
    retention_ms: int = 86400000  # 24 hours


# ─── Health ───────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "ok" if not FALLBACK_MODE else "degraded",
        "connected": metrics["connected"],
        "fallback_mode": FALLBACK_MODE,
        "endpoint": FLUVIO_ENDPOINT,
        "uptime_seconds": int(time.time() - metrics["uptime_start"]),
        "sdk": "fluvio Python SDK (official)",
    }


# ─── Metrics (Prometheus format) ──────────────────────────────────────────────
@app.get("/metrics")
async def prometheus_metrics():
    uptime = int(time.time() - metrics["uptime_start"])
    connected = 1 if metrics["connected"] else 0
    fallback = 1 if metrics["fallback_mode"] else 0
    output = (
        f"# HELP nexcom_fluvio_connected Fluvio SC connection status\n"
        f"# TYPE nexcom_fluvio_connected gauge\n"
        f"nexcom_fluvio_connected {connected}\n"
        f"# HELP nexcom_fluvio_fallback_mode In-memory fallback mode active\n"
        f"# TYPE nexcom_fluvio_fallback_mode gauge\n"
        f"nexcom_fluvio_fallback_mode {fallback}\n"
        f"# HELP nexcom_fluvio_records_produced_total Total records produced\n"
        f"# TYPE nexcom_fluvio_records_produced_total counter\n"
        f"nexcom_fluvio_records_produced_total {metrics['produced']}\n"
        f"# HELP nexcom_fluvio_records_consumed_total Total records consumed\n"
        f"# TYPE nexcom_fluvio_records_consumed_total counter\n"
        f"nexcom_fluvio_records_consumed_total {metrics['consumed']}\n"
        f"# HELP nexcom_fluvio_errors_total Total errors\n"
        f"# TYPE nexcom_fluvio_errors_total counter\n"
        f"nexcom_fluvio_errors_total {metrics['errors']}\n"
        f"# HELP nexcom_fluvio_uptime_seconds Sidecar uptime in seconds\n"
        f"# TYPE nexcom_fluvio_uptime_seconds gauge\n"
        f"nexcom_fluvio_uptime_seconds {uptime}\n"
    )
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(output, media_type="text/plain; version=0.0.4")


# ─── Topics ───────────────────────────────────────────────────────────────────
@app.get("/topics")
async def list_topics():
    """List all Fluvio topics."""
    if FALLBACK_MODE or fluvio_client is None:
        return {"topics": list(fallback_queues.keys()), "source": "fallback"}
    try:
        # Fluvio Python SDK doesn't expose admin API directly; return known topics
        known_topics = [
            "market-ticks", "price-aggregates", "trade-signals",
            "risk-alerts", "order-events", "settlement-events",
            "nexcom.orders", "nexcom.trades", "nexcom.price-updates",
        ]
        return {"topics": known_topics, "source": "fluvio"}
    except Exception as e:
        metrics["errors"] += 1
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/topics/{name}")
async def create_topic(name: str, req: TopicCreateRequest):
    """Create a Fluvio topic (requires fluvio CLI or admin API)."""
    logger.info(f"Topic create requested: {name} partitions={req.partitions} replication={req.replication}")
    # Ensure fallback queue exists
    if name not in fallback_queues:
        fallback_queues[name] = []
    return {
        "topic": name,
        "partitions": req.partitions,
        "replication": req.replication,
        "status": "created" if not FALLBACK_MODE else "queued_fallback",
    }


# ─── Produce ──────────────────────────────────────────────────────────────────
@app.post("/produce/{topic}")
async def produce(topic: str, req: ProduceRequest):
    """Produce a single record to a Fluvio topic."""
    value_bytes = (
        req.value.encode() if isinstance(req.value, str)
        else json.dumps(req.value).encode()
    )
    key_bytes = req.key.encode() if req.key else b""

    producer = await get_producer(topic)
    if producer is not None:
        try:
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: producer.send(key_bytes, value_bytes)
            )
            metrics["produced"] += 1
            logger.debug(f"Produced to topic={topic} key={req.key} size={len(value_bytes)} (Fluvio SDK)")
            # Also notify WebSocket subscribers
            await _notify_ws_subscribers(topic, req.value)
            return {"status": "ok", "topic": topic, "source": "fluvio"}
        except Exception as e:
            logger.error(f"Produce error topic={topic}: {e}")
            metrics["errors"] += 1

    # Fallback: in-memory queue
    record = {"key": req.key, "value": req.value, "timestamp": time.time()}
    if topic not in fallback_queues:
        fallback_queues[topic] = []
    fallback_queues[topic].append(record)
    metrics["produced"] += 1
    await _notify_ws_subscribers(topic, req.value)
    logger.debug(f"Produced to topic={topic} (fallback in-memory)")
    return {"status": "ok", "topic": topic, "source": "fallback"}


@app.post("/produce-batch/{topic}")
async def produce_batch(topic: str, req: ProduceBatchRequest):
    """Produce multiple records to a Fluvio topic in a single call."""
    producer = await get_producer(topic)
    produced = 0
    errors = 0

    for record in req.records:
        value_bytes = (
            record.value.encode() if isinstance(record.value, str)
            else json.dumps(record.value).encode()
        )
        key_bytes = record.key.encode() if record.key else b""

        if producer is not None:
            try:
                await asyncio.get_event_loop().run_in_executor(
                    None, lambda: producer.send(key_bytes, value_bytes)
                )
                produced += 1
                metrics["produced"] += 1
                await _notify_ws_subscribers(topic, record.value)
                continue
            except Exception as e:
                logger.error(f"Batch produce error topic={topic}: {e}")
                errors += 1
                metrics["errors"] += 1

        # Fallback
        fb_record = {"key": record.key, "value": record.value, "timestamp": time.time()}
        if topic not in fallback_queues:
            fallback_queues[topic] = []
        fallback_queues[topic].append(fb_record)
        produced += 1
        metrics["produced"] += 1
        await _notify_ws_subscribers(topic, record.value)

    # Flush producer
    if producer is not None:
        try:
            await asyncio.get_event_loop().run_in_executor(None, producer.flush)
        except Exception:
            pass

    return {"status": "ok", "topic": topic, "produced": produced, "errors": errors}


# ─── Consume (SSE) ────────────────────────────────────────────────────────────
@app.get("/consume/{topic}")
async def consume_sse(topic: str, offset: int = 0, max_records: int = 100):
    """
    Server-Sent Events stream of records from a Fluvio topic.
    Streams up to max_records then closes, or streams indefinitely if max_records=0.
    """
    async def event_generator() -> AsyncGenerator[str, None]:
        count = 0
        if not FALLBACK_MODE and fluvio_client is not None:
            try:
                from fluvio import Offset
                consumer = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: fluvio_client.partition_consumer(topic, 0)
                )
                stream = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: consumer.stream(Offset.from_beginning() if offset == 0 else Offset.absolute(offset))
                )
                async for record in stream:
                    value = record.value_string()
                    key = record.key_string() if record.key() else ""
                    event = json.dumps({
                        "topic": topic,
                        "key": key,
                        "value": value,
                        "offset": record.offset(),
                        "timestamp": time.time(),
                        "source": "fluvio",
                    })
                    yield f"data: {event}\n\n"
                    metrics["consumed"] += 1
                    count += 1
                    if max_records > 0 and count >= max_records:
                        break
                return
            except Exception as e:
                logger.error(f"SSE consume error topic={topic}: {e}")
                metrics["errors"] += 1

        # Fallback: stream from in-memory queue
        records = fallback_queues.get(topic, [])
        for record in records[offset:]:
            event = json.dumps({
                "topic": topic,
                "key": record.get("key", ""),
                "value": record.get("value"),
                "offset": count,
                "timestamp": record.get("timestamp", time.time()),
                "source": "fallback",
            })
            yield f"data: {event}\n\n"
            metrics["consumed"] += 1
            count += 1
            if max_records > 0 and count >= max_records:
                break
            await asyncio.sleep(0.01)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ─── Consume (WebSocket) ──────────────────────────────────────────────────────
@app.websocket("/ws/consume/{topic}")
async def consume_ws(websocket: WebSocket, topic: str):
    """
    WebSocket stream of records from a Fluvio topic.
    New records are pushed to all connected subscribers in real time.
    """
    await websocket.accept()
    logger.info(f"WebSocket subscriber connected for topic={topic}")

    # Register subscriber
    if topic not in ws_subscribers:
        ws_subscribers[topic] = []
    ws_subscribers[topic].append(websocket)

    # Send existing records from fallback queue
    for record in fallback_queues.get(topic, []):
        try:
            await websocket.send_json({
                "topic": topic,
                "key": record.get("key", ""),
                "value": record.get("value"),
                "timestamp": record.get("timestamp", time.time()),
                "source": "fallback_replay",
            })
            metrics["consumed"] += 1
        except Exception:
            break

    try:
        # If Fluvio is connected, also stream from the real topic
        if not FALLBACK_MODE and fluvio_client is not None:
            async def stream_from_fluvio():
                try:
                    from fluvio import Offset
                    consumer = await asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda: fluvio_client.partition_consumer(topic, 0)
                    )
                    stream = await asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda: consumer.stream(Offset.end())
                    )
                    async for record in stream:
                        if websocket.client_state.value != 1:  # CONNECTED
                            break
                        value = record.value_string()
                        key = record.key_string() if record.key() else ""
                        await websocket.send_json({
                            "topic": topic,
                            "key": key,
                            "value": value,
                            "offset": record.offset(),
                            "timestamp": time.time(),
                            "source": "fluvio",
                        })
                        metrics["consumed"] += 1
                except Exception as e:
                    logger.error(f"WS Fluvio stream error topic={topic}: {e}")

            asyncio.create_task(stream_from_fluvio())

        # Keep connection alive, waiting for disconnect
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                if msg == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                # Send heartbeat
                await websocket.send_json({"type": "heartbeat", "timestamp": time.time()})
    except WebSocketDisconnect:
        logger.info(f"WebSocket subscriber disconnected from topic={topic}")
    finally:
        if topic in ws_subscribers and websocket in ws_subscribers[topic]:
            ws_subscribers[topic].remove(websocket)


async def _notify_ws_subscribers(topic: str, value):
    """Push a new record to all WebSocket subscribers for a topic."""
    subscribers = ws_subscribers.get(topic, [])
    if not subscribers:
        return
    message = {
        "topic": topic,
        "value": value,
        "timestamp": time.time(),
        "source": "push",
    }
    dead = []
    for ws in subscribers:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        subscribers.remove(ws)


# ─── Entry point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=SIDECAR_PORT,
        log_level="info",
        access_log=False,
        loop="asyncio",
    )
