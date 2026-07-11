/**
 * OpenTelemetry SDK bootstrap for NEXCOM Exchange.
 *
 * This file MUST be imported before any other server code.
 * It configures:
 *  - Trace export via OTLP/HTTP (Jaeger, Tempo, etc.)
 *  - Metrics export via OTLP/HTTP (Prometheus remote-write compatible)
 *  - Auto-instrumentation for HTTP, Express, pg, mysql2, redis, gRPC
 *
 * Environment variables:
 *  OTEL_ENABLED          - "true" to enable (default: false in dev)
 *  OTEL_SERVICE_NAME     - service name (default: "nexcom-exchange")
 *  OTEL_EXPORTER_OTLP_ENDPOINT - OTLP collector endpoint (default: http://localhost:4318)
 *  OTEL_ENVIRONMENT      - deployment environment label (default: "development")
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const OTEL_ENABLED = process.env.OTEL_ENABLED === "true";
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? "nexcom-exchange";
const SERVICE_VERSION = process.env.npm_package_version ?? "0.0.0";
const OTLP_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
const ENVIRONMENT = process.env.OTEL_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";

let sdk: NodeSDK | null = null;

export function initTelemetry(): void {
  if (!OTEL_ENABLED) {
    console.log("[OTel] Telemetry disabled (OTEL_ENABLED != true)");
    return;
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    "deployment.environment": ENVIRONMENT,
    "nexcom.component": "api-server",
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${OTLP_ENDPOINT}/v1/traces`,
    headers: {},
  });

  const metricExporter = new OTLPMetricExporter({
    url: `${OTLP_ENDPOINT}/v1/metrics`,
  });

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 15_000, // every 15 seconds
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisy instrumentations
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
        // Enable key ones
        "@opentelemetry/instrumentation-http": { enabled: true },
        "@opentelemetry/instrumentation-express": { enabled: true },
        "@opentelemetry/instrumentation-pg": { enabled: true },
        "@opentelemetry/instrumentation-mysql2": { enabled: true },
        "@opentelemetry/instrumentation-redis": { enabled: true },
        "@opentelemetry/instrumentation-grpc": { enabled: true },
      }),
    ],
  });

  sdk.start();
  console.log(`[OTel] Telemetry started — service: ${SERVICE_NAME} → ${OTLP_ENDPOINT}`);

  // Graceful shutdown
  process.on("SIGTERM", () => {
    sdk
      ?.shutdown()
      .then(() => console.log("[OTel] SDK shut down cleanly"))
      .catch((err) => console.error("[OTel] Error shutting down SDK", err));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual span helpers (used in routers for custom business spans)
// ─────────────────────────────────────────────────────────────────────────────

import { trace, context, SpanStatusCode, SpanKind } from "@opentelemetry/api";
import type { Span, Attributes } from "@opentelemetry/api";

const tracer = trace.getTracer(SERVICE_NAME, SERVICE_VERSION);

/**
 * Wrap an async function in an OpenTelemetry span.
 * If OTEL_ENABLED is false, the function is called directly with no overhead.
 */
export async function withSpan<T>(
  spanName: string,
  attrs: Attributes,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  if (!OTEL_ENABLED) return fn(trace.getActiveSpan() as Span ?? createNoopSpan());

  return tracer.startActiveSpan(
    spanName,
    { kind: SpanKind.INTERNAL, attributes: attrs },
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    }
  );
}

/** Record a business event as a span event on the active span (fire-and-forget). */
export function recordEvent(name: string, attrs?: Attributes): void {
  if (!OTEL_ENABLED) return;
  const span = trace.getActiveSpan();
  if (span) span.addEvent(name, attrs);
}

/** Set attributes on the currently active span. */
export function setSpanAttrs(attrs: Attributes): void {
  if (!OTEL_ENABLED) return;
  const span = trace.getActiveSpan();
  if (span) span.setAttributes(attrs);
}

// Noop span for when OTel is disabled
function createNoopSpan(): Span {
  return {
    setAttribute: () => ({} as Span),
    setAttributes: () => ({} as Span),
    addEvent: () => ({} as Span),
    setStatus: () => ({} as Span),
    recordException: () => {},
    end: () => {},
    isRecording: () => false,
    spanContext: () => ({ traceId: "0", spanId: "0", traceFlags: 0 }),
    updateName: () => ({} as Span),
  } as unknown as Span;
}
