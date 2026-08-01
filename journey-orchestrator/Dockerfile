FROM golang:1.22-alpine AS builder
WORKDIR /build
RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum* ./
RUN go mod download || true

COPY . .
RUN go build -o /bin/journey-worker ./cmd/worker/
RUN go build -o /bin/journey-api ./cmd/api/

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /bin/journey-worker /bin/journey-worker
COPY --from=builder /bin/journey-api    /bin/journey-api

ENV TEMPORAL_ADDRESS=temporal:7233
ENV TEMPORAL_NAMESPACE=nexcom
ENV JOURNEY_API_PORT=8015
ENV MODE=worker

ENTRYPOINT ["/bin/sh", "-c", "if [ \"$MODE\" = 'api' ]; then exec /bin/journey-api; else exec /bin/journey-worker; fi"]
