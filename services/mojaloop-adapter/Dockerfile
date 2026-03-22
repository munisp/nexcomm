# ── Build stage ──────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

# Download dependencies first (layer cache)
COPY go.mod go.sum ./
RUN go mod download

# Copy source and build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s -X main.version=$(git describe --tags --always 2>/dev/null || echo dev)" \
    -o /bin/mojaloop-adapter ./cmd/server

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /bin/mojaloop-adapter /mojaloop-adapter

EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["/mojaloop-adapter", "-health"]

ENTRYPOINT ["/mojaloop-adapter"]
