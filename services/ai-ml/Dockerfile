# NEXCOM Exchange - AI/ML Service Dockerfile
# Trains and serves scikit-learn models (IsolationForest, GradientBoosting, LSTM) on CPU.
FROM python:3.11-slim AS builder
WORKDIR /app
RUN pip install --no-cache-dir poetry
COPY pyproject.toml poetry.lock* ./
RUN poetry config virtualenvs.create false && \
    poetry install --no-interaction --no-ansi --no-root

FROM python:3.11-slim
WORKDIR /app
# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
# Copy application source
COPY src ./src
# Model registry directory — mounted as a volume for persistence across restarts
RUN mkdir -p /tmp/nexcom_models
ENV MODEL_REGISTRY_PATH=/tmp/nexcom_models
EXPOSE 8007
# Use 1 worker — models are singleton, multi-worker would retrain each worker
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8007", "--workers", "1"]
