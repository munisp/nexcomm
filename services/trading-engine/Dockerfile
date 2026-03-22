# NEXCOM Exchange - Trading Engine Dockerfile
# Multi-stage build for minimal production image
FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /trading-engine ./cmd/...

FROM alpine:3.19
RUN apk --no-cache add ca-certificates tzdata
COPY --from=builder /trading-engine /usr/local/bin/trading-engine

ENV GIN_MODE=release
EXPOSE 8001

ENTRYPOINT ["trading-engine"]
