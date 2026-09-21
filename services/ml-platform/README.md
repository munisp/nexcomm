# NEXCOM ML Platform (`services/ml-platform`)

Real PyTorch training + serving + monitoring layer for the NEXCOM commodity
exchange. Replaces the synthetic-only AI/ML stack documented in audit A3
(numpy "LSTM", sklearn IsolationForest on random data, RNG "GNN", no registry,
no MLflow, no Ray, no Neo4j) with versioned artifacts, deterministic
champion/challenger serving, exposure logging, and drift/performance alerting.

## Architecture

```
                 ┌────────────────────────── NEXCOM platform ──────────────────────────┐
                 │                                                                      │
  Postgres ──▶ extractor ─┐              ┌─────────────┐      ┌──────────────────────┐  │
  (DATABASE_URL)          │   parquet/   │  lakehouse  │      │  registry (local fs  │  │
                          ├──▶ bronze ──▶│  silver     │─────▶│  or MLflow adapter)  │  │
  synthetic_nigeria ──────┘   csv        │  gold       │      │  <name>/v<n>/model.pt│  │
  (offline bootstrap)                    └─────┬───────┘      └─────────┬────────────┘  │
                                               │ features/sequences/graph│ champion/    │
                                               ▼                         ▼ challenger    │
  Ray cluster (RAY_ADDRESS) ◀── compute ── training CLIs        serving/app (FastAPI)    │
  or local process pool        backend    fraud/credit/         :8015 CPU torch          │
                                          price/gnn             ├ /v1/predict/fraud      │
                                                                ├ /v1/predict/credit     │
  monitoring/drift (PSI+KS+TV) ◀── exposure JSONL ◀── A/B ──────├ /v1/predict/price      │
  monitoring/performance ──────── (serving/ab.py)    buckets    ├ /v1/predict/graph      │
           │                                                    ├ /v1/models             │
           ▼                                                    ├ /v1/admin/reload       │
  ALERT_WEBHOOK_URL ──▶ middleware-hub                          └─────────▲──────────────┘
                 │                                                        │ httpx, 2s,
   consumers: ai-ml (risk scoring, forecasting, anomaly), fraud-engine ───┘ circuit breaker
```

## Quickstart (offline, CPU-only)

```bash
cd services/ml-platform
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install fastapi uvicorn pydantic numpy pandas scikit-learn scipy networkx joblib httpx

# Full loop: synthetic Nigerian agri data → lakehouse → train 4 models →
# register → promotion gate → drift baselines
python -m mlplatform.pipelines.end_to_end --transactions 20000 --epochs 3

# Serve
export REGISTRY_PATH=/data/model_registry LAKEHOUSE_PATH=/data/lakehouse
python -m mlplatform.serving.app            # :8015

curl localhost:8015/readyz
curl -X POST localhost:8015/v1/predict/fraud -H 'content-type: application/json' -d '{
  "account_id": "acct-001", "amount": 5000000, "currency": "NGN",
  "transaction_type": "withdrawal", "channel": "ussd", "state": "Kano",
  "commodity": "maize", "txns_last_1h": 12, "new_payee": true}'

# Monitoring
python -m mlplatform.monitoring.drift --model fraud --live-file live.csv
python -m mlplatform.monitoring.performance --model fraud \
    --labels-file labels.csv --label-column is_fraud

# Smoke test
python -m pytest tests/test_serving.py -q
```

Docker (overlay, does not modify `docker-compose.yml`):

```bash
docker compose -f docker-compose.yml -f docker-compose.ml.yml up ml-platform mlflow neo4j ray-head ray-worker
```

## Configuration (env)

| Var | Default | Purpose |
|---|---|---|
| `ML_PLATFORM_PORT` | `8015` | serving port |
| `REGISTRY_PATH` | `/data/model_registry` | local registry root (volume `model_registry_data`) |
| `LAKEHOUSE_PATH` | `/data/lakehouse` | bronze/silver/gold root (volume `lakehouse_data`) |
| `MLFLOW_TRACKING_URI` | unset | when set + mlflow installed → MLflow registry adapter |
| `RAY_ADDRESS` | unset | when set + ray installed → Ray compute backend |
| `DATABASE_URL` | unset | Postgres extractor source |
| `NEO4J_URI` | unset | live graph MERGE load |
| `ALERT_WEBHOOK_URL` | unset | drift/performance alert target (guarded httpx POST) |
| `AB_CHALLENGER_PCT` / `AB_CHALLENGER_PCT_<MODEL>` | `0` | challenger traffic % |
| `EXPOSURE_LOG_PATH` | `$REGISTRY_PATH/exposures` | A/B exposure JSONL |
| `PROMOTION_MARGIN` | `0.01` | min champion-beating margin for promotion |
| `DRIFT_PSI_THRESHOLD` / `DRIFT_KS_PVALUE_THRESHOLD` / `DRIFT_TV_THRESHOLD` | `0.2` / `0.01` / `0.2` | drift alert thresholds |
| `DEGRADATION_TOLERANCE` | `0.05` | live-vs-registered metric degradation tolerance |
| `ML_PLATFORM_NUM_THREADS` | `min(4, cpus)` | torch CPU intra-op threads |

## Capability matrix (honest)

| Capability | Core deps only (offline CPU) | With optional deps |
|---|---|---|
| Torch CPU inference (fraud/credit/price/graph) | ✅ | ✅ |
| Versioned model registry | ✅ local fs (`REGISTRY_PATH/<name>/v<n>/`) | MLflow tracking + artifacts (`MLFLOW_TRACKING_URI`) |
| Champion/challenger A/B + exposure JSONL | ✅ | ✅ |
| Drift (PSI/KS/TV) + webhook alerts | ✅ scipy | ✅ |
| Live performance join + degradation alerts | ✅ pandas | ✅ |
| Distributed training | local thread/process pool | Ray cluster (`RAY_ADDRESS`, ray-head/ray-worker in `docker-compose.ml.yml`) |
| Parquet lakehouse I/O | CSV partitions fallback | pyarrow parquet |
| Postgres → bronze extraction | CSV export contract fallback | psycopg2 (`DATABASE_URL`) |
| Graph store | neo4j-admin import CSVs + LOAD script | live MERGE via neo4j driver (`NEO4J_URI`) |
| Prometheus metrics | — | prometheus-client |

No code path fabricates outputs: a missing model returns HTTP 503 with an
explicit reason; a missing optional dependency falls back to a real local
implementation, never to random numbers.

## Artifact contract (registry `<name>/v<n>/`)

| File | Content |
|---|---|
| `model.pt` | full `nn.Module` or `{"state_dict": ..., "hyperparameters": {...}}` |
| `metrics.json` | validation metrics (`auc`, `log_loss`, `rmse`, ...) |
| `feature_schema.json` | `{"numeric": [...], "categorical": [{name, cardinality}], "sequence_length"?, "num_features"?}` |
| `reference_stats.json` | drift baseline (see `mlplatform.monitoring.drift`) |
| `metadata.json` | `model_type`, trained_at, git sha, ... |

## Integration with legacy services

- `services/ai-ml` routes call `POST /v1/predict/*` via
  `services/ai-ml/src/mlplatform_client.py` (2s timeout, circuit breaker);
  on failure they fall back to the legacy sklearn path and mark responses
  `model_source: "legacy-synthetic"` (vs `"ml-platform@<name>:<version>"`).
- `services/fraud-engine` scores transactions via `/v1/predict/fraud` and its
  `/model/retrain` triggers `POST /v1/admin/retrain` (real pipeline run)
  instead of reseeding synthetic IsolationForests.
