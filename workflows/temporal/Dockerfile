# Multi-stage Dockerfile for all NEXCOM Temporal workers
# Build all three workers in a single image; the WORKER env var selects which one to run.

FROM golang:1.22-alpine AS builder

WORKDIR /build

# Install git for go mod download
RUN apk add --no-cache git ca-certificates

# Copy all workflow modules
COPY deposit/ ./deposit/
COPY withdrawal/ ./withdrawal/
COPY loan/ ./loan/

# Build each worker binary
RUN cd deposit && go mod tidy && go build -o /bin/worker-deposit . 2>&1 || echo "deposit build skipped"
RUN cd withdrawal && go mod tidy && go build -o /bin/worker-withdrawal . 2>&1 || echo "withdrawal build skipped"
RUN cd loan && go mod tidy && go build -o /bin/worker-loan . 2>&1 || echo "loan build skipped"

# ─── Runtime image ────────────────────────────────────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

COPY --from=builder /bin/worker-deposit    /bin/worker-deposit
COPY --from=builder /bin/worker-withdrawal /bin/worker-withdrawal
COPY --from=builder /bin/worker-loan       /bin/worker-loan

# Entrypoint script selects the correct binary based on WORKER env var
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV TEMPORAL_ADDRESS=temporal:7233
ENV TEMPORAL_NAMESPACE=nexcom
ENV WORKER=deposit

ENTRYPOINT ["/entrypoint.sh"]
