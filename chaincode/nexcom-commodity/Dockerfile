# ── Build stage ──────────────────────────────────────────────────────────────
FROM golang:1.21-alpine AS builder

WORKDIR /chaincode

# Copy module files first for layer caching
COPY go.mod go.sum* ./
RUN go mod download

# Copy source
COPY . .

# Build the chaincode binary
RUN CGO_ENABLED=0 GOOS=linux go build -o /nexcom-commodity-chaincode .

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates

COPY --from=builder /nexcom-commodity-chaincode /usr/local/bin/nexcom-commodity-chaincode

# Hyperledger Fabric chaincode listens on the port passed via CORE_CHAINCODE_ADDRESS
# The peer sets this automatically during deployment.
ENTRYPOINT ["/usr/local/bin/nexcom-commodity-chaincode"]
