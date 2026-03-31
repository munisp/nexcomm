"""
shared/tracing.py — OpenTelemetry bootstrap for NEXCOM Python microservices.

Usage:
    from shared.tracing import init_tracing
    init_tracing("analytics-service")

Environment variables (optional):
    OTEL_EXPORTER_OTLP_ENDPOINT  — OTLP gRPC endpoint (default: http://localhost:4317)
    OTEL_SERVICE_VERSION         — service version string (default: 1.0.0)
    ENVIRONMENT                  — deployment environment (default: production)
"""
from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

# Graceful import — OTel packages are optional at runtime
try:
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
    from opentelemetry.sdk.resources import Resource, SERVICE_NAME, SERVICE_VERSION
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
    _OTEL_AVAILABLE = True
except ImportError:
    _OTEL_AVAILABLE = False
    logger.warning("[tracing] opentelemetry packages not installed — tracing disabled")


def init_tracing(
    service_name: str,
    otlp_endpoint: Optional[str] = None,
    *,
    instrument_fastapi: bool = True,
    instrument_httpx: bool = True,
    instrument_sqlalchemy: bool = False,
) -> None:
    """
    Bootstrap OpenTelemetry for a FastAPI microservice.

    Args:
        service_name:          Logical service name (e.g. "analytics-service").
        otlp_endpoint:         Override OTLP gRPC endpoint.
        instrument_fastapi:    Auto-instrument FastAPI request spans.
        instrument_httpx:      Auto-instrument outbound httpx calls.
        instrument_sqlalchemy: Auto-instrument SQLAlchemy queries.
    """
    if not _OTEL_AVAILABLE:
        return

    endpoint = (
        otlp_endpoint
        or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")
    )
    version  = os.getenv("OTEL_SERVICE_VERSION", "1.0.0")
    env      = os.getenv("ENVIRONMENT", "production")

    resource = Resource.create({
        SERVICE_NAME:    service_name,
        SERVICE_VERSION: version,
        "deployment.environment": env,
    })

    provider = TracerProvider(resource=resource)

    # OTLP exporter (Jaeger / Tempo / Collector)
    try:
        otlp_exporter = OTLPSpanExporter(endpoint=endpoint, insecure=True)
        provider.add_span_processor(BatchSpanProcessor(otlp_exporter))
        logger.info("[tracing] OTLP exporter configured → %s", endpoint)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[tracing] OTLP exporter failed (%s) — falling back to console", exc)
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))

    trace.set_tracer_provider(provider)

    if instrument_fastapi:
        try:
            FastAPIInstrumentor().instrument()
            logger.info("[tracing] FastAPI instrumented")
        except Exception as exc:  # noqa: BLE001
            logger.warning("[tracing] FastAPI instrumentation failed: %s", exc)

    if instrument_httpx:
        try:
            HTTPXClientInstrumentor().instrument()
            logger.info("[tracing] httpx instrumented")
        except Exception as exc:  # noqa: BLE001
            logger.warning("[tracing] httpx instrumentation failed: %s", exc)

    if instrument_sqlalchemy:
        try:
            SQLAlchemyInstrumentor().instrument()
            logger.info("[tracing] SQLAlchemy instrumented")
        except Exception as exc:  # noqa: BLE001
            logger.warning("[tracing] SQLAlchemy instrumentation failed: %s", exc)

    logger.info("[tracing] OpenTelemetry initialised for service '%s'", service_name)


def get_tracer(name: str) -> "trace.Tracer":
    """Return a named tracer (no-op if OTel is unavailable)."""
    if not _OTEL_AVAILABLE:
        class _NoOpTracer:
            def start_as_current_span(self, *a, **kw):
                from contextlib import contextmanager
                @contextmanager
                def _noop(*_, **__):
                    yield None
                return _noop()
        return _NoOpTracer()  # type: ignore[return-value]
    return trace.get_tracer(name)
