# NEXCOM Exchange - Market Data Service Dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /market-data ./cmd/...

FROM alpine:3.19
RUN apk --no-cache add ca-certificates tzdata
COPY --from=builder /market-data /usr/local/bin/market-data
EXPOSE 8002 8003
ENTRYPOINT ["market-data"]
