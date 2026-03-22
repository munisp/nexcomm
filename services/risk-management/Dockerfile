# NEXCOM Exchange - Risk Management Service Dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /risk-management ./cmd/...

FROM alpine:3.19
RUN apk --no-cache add ca-certificates tzdata
COPY --from=builder /risk-management /usr/local/bin/risk-management
EXPOSE 8004
ENTRYPOINT ["risk-management"]
