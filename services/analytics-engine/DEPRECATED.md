# SUPERSEDED — services/analytics-engine

This service is **superseded by `services/analytics`** and has been removed
from `docker-compose.yml`.

## Rationale

- `services/analytics` is the more complete implementation: it routes queries
  through the real lakehouse client (`middleware/lakehouse.py` — DataFusion /
  PyArrow over Delta Lake) and fails closed with honest 503s when the lakehouse
  is unavailable.
- This service's 13 endpoints (`/api/v1/analytics/microstructure/*`,
  `/top-movers`, `/ohlcv/*`, etc.) return **deterministic synthetic data**
  (symbol+timestamp-seeded prices) — mockware, not real analytics.

## Consequences

`server/routers/analyticsEngineRouter.ts` proxies to `ANALYTICS_ENGINE_URL`;
with this service undeployed those procedures fail closed (fetch error) rather
than serving fabricated numbers. Source retained for reference only.
