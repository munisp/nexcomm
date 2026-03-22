# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

COPY go.mod go.sum* ./
RUN go mod download

COPY . .

# Build the middleware hub binary (includes Temporal worker mode)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w -X main.Version=$(git describe --tags --always 2>/dev/null || echo dev)" \
    -o /nexcom-middleware-hub ./cmd/main.go

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata curl

# Create non-root user
RUN addgroup -S nexcom && adduser -S nexcom -G nexcom

COPY --from=builder /nexcom-middleware-hub /app/nexcom-middleware-hub

USER nexcom
WORKDIR /app

# Expose HTTP port (used in API mode)
EXPOSE 8080

# Health check — Temporal worker mode exposes a /healthz endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8080/healthz || exit 1

# Default: run as Temporal worker.
# Override CMD to "api" to run as the HTTP middleware API server.
ENTRYPOINT ["/app/nexcom-middleware-hub"]
CMD ["--mode=worker"]
