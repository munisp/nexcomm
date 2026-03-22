FROM golang:1.22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -o /aml-alert-subscriber .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates curl
RUN addgroup -S nexcom && adduser -S nexcom -G nexcom
COPY --from=builder /aml-alert-subscriber /app/aml-alert-subscriber
USER nexcom
WORKDIR /app
EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8091/healthz || exit 1
ENTRYPOINT ["/app/aml-alert-subscriber"]
