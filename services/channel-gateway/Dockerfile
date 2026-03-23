# ─── Build stage ──────────────────────────────────────────────────────────────
FROM golang:1.22-bookworm AS builder

WORKDIR /build
COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o nexcom-channel-gateway ./cmd/server

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12

WORKDIR /app
COPY --from=builder /build/nexcom-channel-gateway ./

ENV GIN_MODE=release
ENV CHANNEL_GATEWAY_PORT=8030

EXPOSE 8030

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/nexcom-channel-gateway", "-health"]

CMD ["/app/nexcom-channel-gateway"]
