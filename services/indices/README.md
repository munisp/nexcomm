# NEXCOM Commodity Indices Service

A high-performance Go microservice that calculates and serves real-time commodity price indices for the NEXCOM Exchange platform. Exposes data via gRPC with Prometheus metrics.

## Overview

This service implements multiple index calculation methodologies used in commodity markets:

| Methodology | Description | Use Case |
|-------------|-------------|----------|
| **Price-Weighted** | Sum of prices / divisor (Dow Jones style) | Simple grain indices |
| **Value-Weighted** | Market cap weighted (S&P 500 style) | Composite NAXI index |
| **Equal-Weighted** | Equal contribution per component | Oilseed index |
| **Geometric Mean** | Geometric average of price ratios | Volatility-adjusted |
| **Laspeyres** | Base-period quantity weights | Standard price index |
| **Paasche** | Current-period quantity weights | Volume-adjusted |
| **Fisher Ideal** | Geometric mean of Laspeyres and Paasche | Best-practice composite |

## Predefined Indices

| Index ID | Name | Methodology | Currency | Components |
|----------|------|-------------|----------|------------|
| `NAXI` | NEXCOM Agri Index | Value-Weighted | NGN | 11 commodities |
| `NGGI` | Nigeria Grain Index | Price-Weighted | NGN | 5 grains |
| `AOXI` | Africa Oilseed Index | Equal-Weighted | USD | 4 oilseeds |
| `WACCI` | West Africa Cash Crop Index | Value-Weighted | USD | 4 cash crops |

## Architecture

```
cmd/server/main.go          ← gRPC server entry point
internal/
  calculator/calculator.go  ← Index calculation algorithms
  grpc/server.go            ← gRPC service implementation
  models/index.go           ← Data models
  db/                       ← PostgreSQL + TimescaleDB queries
proto/indices.proto         ← gRPC service definition
config/                     ← Configuration management
```

## gRPC API

```protobuf
service CommodityIndicesService {
  rpc GetIndex(GetIndexRequest) returns (GetIndexResponse);
  rpc GetAllIndices(GetAllIndicesRequest) returns (GetAllIndicesResponse);
  rpc GetIndexHistory(GetIndexHistoryRequest) returns (GetIndexHistoryResponse);
  rpc StreamIndex(StreamIndexRequest) returns (stream IndexUpdate);
  rpc GetCommodityPrice(GetCommodityPriceRequest) returns (GetCommodityPriceResponse);
  rpc GetMarketSummary(GetMarketSummaryRequest) returns (GetMarketSummaryResponse);
  rpc CalculateBasket(CalculateBasketRequest) returns (CalculateBasketResponse);
}
```

## Running the Service

### Local Development

```bash
# Install dependencies
go mod download

# Generate protobuf code
protoc --go_out=. --go-grpc_out=. proto/indices.proto

# Run the service
go run ./cmd/server

# Or with custom ports
GRPC_PORT=50053 METRICS_PORT=9093 go run ./cmd/server
```

### Docker

```bash
# Build image
docker build -t nexcom-indices:latest .

# Run container
docker run -p 50053:50053 -p 9093:9093 \
  -e DATABASE_URL=postgres://nexcom:pass@localhost/nexcom \
  -e REDIS_URL=redis://localhost:6379 \
  nexcom-indices:latest
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nexcom-indices
  namespace: nexcom
spec:
  replicas: 2
  selector:
    matchLabels:
      app: nexcom-indices
  template:
    spec:
      containers:
      - name: indices
        image: nexcom-indices:latest
        ports:
        - containerPort: 50053
          name: grpc
        - containerPort: 9093
          name: metrics
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: nexcom-db
              key: url
        livenessProbe:
          grpc:
            port: 50053
        readinessProbe:
          httpGet:
            path: /ready
            port: 9093
```

## Testing with grpcurl

```bash
# List services
grpcurl -plaintext localhost:50053 list

# Get all indices
grpcurl -plaintext localhost:50053 nexcom.indices.v1.CommodityIndicesService/GetAllIndices

# Get specific index
grpcurl -plaintext -d '{"index_id": "NAXI"}' \
  localhost:50053 nexcom.indices.v1.CommodityIndicesService/GetIndex

# Stream index updates
grpcurl -plaintext -d '{"index_ids": ["NAXI", "NGGI"], "interval_seconds": 5}' \
  localhost:50053 nexcom.indices.v1.CommodityIndicesService/StreamIndex

# Get commodity price
grpcurl -plaintext -d '{"symbol": "MAIZE"}' \
  localhost:50053 nexcom.indices.v1.CommodityIndicesService/GetCommodityPrice

# Calculate custom basket
grpcurl -plaintext -d '{
  "name": "My Basket",
  "components": [
    {"symbol": "MAIZE", "weight": 0.5},
    {"symbol": "SOYBEAN", "weight": 0.5}
  ],
  "currency": "NGN"
}' localhost:50053 nexcom.indices.v1.CommodityIndicesService/CalculateBasket
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GRPC_PORT` | `50053` | gRPC server port |
| `METRICS_PORT` | `9093` | Prometheus metrics port |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | — | Redis connection for price cache |
| `LOG_LEVEL` | `info` | Log level (debug/info/warn/error) |
| `LOG_FORMAT` | `console` | Log format (console/json) |

## Metrics

Prometheus metrics exposed at `:9093/metrics`:

- `nexcom_index_calculation_duration_seconds` — Index calculation latency
- `nexcom_index_value` — Current index values (gauge)
- `nexcom_price_requests_total` — Total price requests
- `nexcom_grpc_requests_total` — Total gRPC requests by method

## Integration with NEXCOM Exchange

The indices service is called by the main NEXCOM Exchange backend via gRPC:

```typescript
// server/routers/commodityIndices.ts
import { createChannel, createClient } from 'nice-grpc';
import { CommodityIndicesServiceDefinition } from '../proto/indices';

const channel = createChannel('localhost:50053');
const client = createClient(CommodityIndicesServiceDefinition, channel);

// Get all indices
const { indices } = await client.getAllIndices({ category: 'COMPOSITE' });
```
